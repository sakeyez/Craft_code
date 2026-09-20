/** Operation-scoped Minecraft downloads and Java proxy configuration. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, ProxyAgent, interceptors } from 'undici';
import { z } from 'zod';
import Schema from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
/** Persisted user preference; credentials are deliberately unsupported. */
export const NetworkSettingsSchema = z
    .object({
    mode: z.enum(['auto', 'direct', 'proxy']).default('auto'),
    proxyUrl: z.string().max(2048).default(''),
})
    .superRefine((value, ctx) => {
    if (value.mode === 'proxy') {
        try {
            validateProxy(value.proxyUrl);
        }
        catch {
            ctx.addIssue({ code: 'custom', message: '请输入不含账号密码的 HTTP/HTTPS 代理地址。', path: ['proxyUrl'] });
        }
    }
});
const namespace = settingsNamespace('minecraft-network');
const settingsSchema = Schema.object({
    mode: Schema.union(['auto', 'direct', 'proxy']).default('auto'),
    proxyUrl: Schema.string().default(''),
});
const scope = new AsyncLocalStorage();
const direct = new Agent({
    connections: 8,
    connect: { timeout: 4000 },
    headersTimeout: 10_000,
    bodyTimeout: 120_000,
    keepAliveTimeout: 1000,
});
function validateProxy(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('代理地址无效，请使用 HTTP/HTTPS 代理端口。');
    }
    if (!['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash)
        throw new Error('不支持 SOCKS、PAC 地址或带账号密码的代理，请使用 HTTP/HTTPS 代理端口。');
    return url.origin;
}
/**
 * Exact publication mappings; arbitrary Maven repositories are never rewritten.
 * @param input - Official HTTPS publication URL.
 * @returns Ordered mirror and official URLs.
 */
export function minecraftDownloadSources(input) {
    const url = new URL(input);
    let mirror;
    if (url.hostname === 'meta.fabricmc.net')
        mirror = 'https://bmclapi2.bangbang93.com/fabric-meta' + url.pathname + url.search;
    if (url.hostname === 'maven.fabricmc.net')
        mirror = 'https://bmclapi2.bangbang93.com/maven' + url.pathname;
    if (url.hostname === 'libraries.minecraft.net')
        mirror = 'https://bmclapi2.bangbang93.com/maven' + url.pathname;
    if (['repo.maven.apache.org', 'repo1.maven.org'].includes(url.hostname) && url.pathname.startsWith('/maven2/'))
        mirror = 'https://maven.aliyun.com/repository/public/' + url.pathname.slice('/maven2/'.length);
    if (url.hostname === 'resources.download.minecraft.net')
        mirror = 'https://bmclapi2.bangbang93.com/assets' + url.pathname;
    if (['piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com', 'launcher.mojang.com'].includes(url.hostname))
        mirror = 'https://bmclapi2.bangbang93.com' + url.pathname;
    if (['services.gradle.org', 'downloads.gradle.org'].includes(url.hostname) &&
        /^\/distributions\/gradle-[\d.]+-bin\.zip$/u.test(url.pathname))
        mirror = 'https://mirrors.huaweicloud.com/gradle/' + (url.pathname.split('/').at(-1) ?? '');
    return mirror ? [mirror, input] : [input];
}
/** Ask the supervising Electron process to resolve its current system proxy. */
async function desktopProxy(url) {
    if (!process.send || process.env.DSH_SUPERVISOR_IPC !== '1')
        return undefined;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
        const finish = (value) => {
            clearTimeout(timer);
            process.off('message', listener);
            resolve(value);
        };
        const listener = (message) => {
            if (typeof message !== 'object' ||
                message === null ||
                !('type' in message) ||
                message.type !== 'dsh/network-proxy-result' ||
                !('id' in message) ||
                message.id !== id)
                return;
            if ('error' in message) {
                clearTimeout(timer);
                process.off('message', listener);
                reject(new Error('系统代理查询失败，请在 Minecraft 网络设置中选择直连或指定 HTTP 代理。'));
            }
            else
                finish('proxy' in message && typeof message.proxy === 'string' ? message.proxy : undefined);
        };
        const timer = setTimeout(() => {
            finish();
        }, 3000);
        process.on('message', listener);
        process.send?.({ type: 'dsh/network-proxy', id, url }, () => { });
    });
}
/** One immutable settings snapshot and its reusable connection pools. */
export class NetworkOperation {
    settings;
    inheritedProxy;
    agents;
    successful;
    constructor(settings, inheritedProxy, agents = new Map(), successful = new Map()) {
        this.settings = settings;
        this.inheritedProxy = inheritedProxy;
        this.agents = agents;
        this.successful = successful;
    }
    async proxy(url) {
        if (this.settings.mode === 'direct')
            return undefined;
        if (this.settings.mode === 'proxy')
            return validateProxy(this.settings.proxyUrl);
        const inherited = this.inheritedProxy;
        if (inherited)
            return validateProxy(inherited);
        const system = await desktopProxy(url);
        if (!system || system === 'DIRECT')
            return undefined;
        const first = system.split(';')[0]?.trim() ?? '';
        const match = /^(PROXY|HTTPS) ([^\s]+)$/u.exec(first);
        if (!match)
            throw new Error('系统代理返回不支持的 SOCKS/PAC 结果，请在 Minecraft 网络设置中指定 HTTP/HTTPS 端口或直连。');
        return validateProxy(`${match[1] === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
    }
    /**
     * Supply the installer's streaming transport; its transfer layer owns retries.
     * @returns Shared proxy-aware dispatcher with bounded connections.
     */
    async installerDispatcher() {
        const proxy = await this.proxy('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        if (!proxy)
            return direct.compose(interceptors.redirect({ maxRedirections: 5 }));
        const agent = this.agents.get(proxy) ?? new ProxyAgent({ uri: proxy, connections: 8, keepAliveTimeout: 1000 });
        this.agents.set(proxy, agent);
        return agent.compose(interceptors.redirect({ maxRedirections: 5 }));
    }
    /**
     * Fetch an HTTPS resource with bounded retries and per-origin fallback.
     * @param input - Official resource URL.
     * @param init - HTTP options and caller cancellation.
     * @param maxBytes - Complete payload size limit.
     * @param sha256 - Optional official digest; a mismatch rejects that route.
     * @returns Fully read, validated response.
     * @param sink - Streaming response consumer responsible for validation and commit.
     * @param headersForAttempt - Fresh Range headers based on retained partial bytes.
     */
    async fetch(input, init = {}, maxBytes = 8 * 1024 * 1024, sha256, sink, headersForAttempt) {
        const url = new URL(input);
        if (url.protocol !== 'https:' || url.username || url.password)
            throw new Error('下载地址必须是无凭据的 HTTPS 地址。');
        const signal = AbortSignal.any([
            ...(init.signal ? [init.signal] : []),
            AbortSignal.timeout(maxBytes > 8 * 1024 * 1024 ? 15 * 60_000 : 120_000),
        ]);
        const sources = minecraftDownloadSources(input);
        let proxy;
        let proxyError;
        try {
            proxy = await this.proxy(input);
        }
        catch (error) {
            if (this.settings.mode !== 'auto')
                throw error;
            proxyError = error instanceof Error ? error.message : '系统代理不可用';
        }
        const routes = this.settings.mode === 'proxy'
            ? sources.map(source => ({ source, proxy }))
            : [
                ...sources
                    .filter(source => source !== input)
                    .map(source => ({ source, proxy: undefined })),
                ...(proxy ? [{ source: input, proxy }] : []),
                { source: input, proxy: undefined },
            ];
        const key = `${this.settings.mode}:${proxy ?? ''}:${input}`;
        const preferred = this.successful.get(key);
        if (preferred && preferred.until > Date.now())
            routes.sort((a, b) => Number(b.source === preferred.source && b.proxy === preferred.proxy) -
                Number(a.source === preferred.source && a.proxy === preferred.proxy));
        const attempts = proxyError ? [proxyError] : [];
        let failureCode = 'NETWORK';
        for (const route of routes) {
            let dispatcher = direct;
            if (route.proxy) {
                dispatcher =
                    this.agents.get(route.proxy) ?? new ProxyAgent({ uri: route.proxy, connections: 8, keepAliveTimeout: 1000 });
                this.agents.set(route.proxy, dispatcher);
            }
            for (let attempt = 0; attempt < 3; attempt++) {
                signal.throwIfAborted();
                let retryDelay = 250 * 2 ** attempt;
                try {
                    const request = {
                        ...init,
                        ...(headersForAttempt ? { headers: headersForAttempt() } : {}),
                        signal: AbortSignal.any([signal, AbortSignal.timeout(maxBytes > 8 * 1024 * 1024 ? 300_000 : 5000)]),
                        dispatcher,
                    };
                    const response = await fetch(route.source, request);
                    if (sink && (response.ok || response.status === 416)) {
                        await sink(response);
                        if (this.successful.size >= 64)
                            this.successful.clear();
                        this.successful.set(key, {
                            source: route.source,
                            ...(route.proxy ? { proxy: route.proxy } : {}),
                            until: Date.now() + 300_000,
                        });
                        return new Response(null, { status: 204 });
                    }
                    if (response.ok) {
                        if (Number(response.headers.get('content-length')) > maxBytes) {
                            await response.body?.cancel();
                            throw new Error('下载超过大小限制。');
                        }
                        const reader = response.body?.getReader();
                        const parts = [];
                        let size = 0;
                        try {
                            while (reader) {
                                const chunk = await reader.read();
                                if (chunk.done)
                                    break;
                                size += chunk.value.byteLength;
                                if (size > maxBytes)
                                    throw new Error('下载超过大小限制。');
                                parts.push(chunk.value);
                            }
                        }
                        finally {
                            await reader?.cancel().catch(() => { });
                        }
                        const bytes = Buffer.concat(parts);
                        if (!response.headers.get('content-encoding') &&
                            response.headers.has('content-length') &&
                            bytes.length !== Number(response.headers.get('content-length')))
                            throw new Error('下载响应不完整。');
                        if (response.headers.get('content-type')?.includes('application/json'))
                            JSON.parse(bytes.toString('utf8'));
                        if (sha256 && createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
                            failureCode = 'CHECKSUM';
                            attempts.push(`${new URL(route.source).hostname} SHA-256 校验失败`);
                            break;
                        }
                        if (this.successful.size >= 64)
                            this.successful.clear();
                        this.successful.set(key, {
                            source: route.source,
                            ...(route.proxy ? { proxy: route.proxy } : {}),
                            until: Date.now() + 300_000,
                        });
                        const headers = new Headers(response.headers);
                        headers.delete('content-encoding');
                        headers.set('content-length', String(bytes.length));
                        headers.set('x-craftcode-source', new URL(route.source).hostname);
                        headers.set('x-craftcode-route', route.proxy ? 'proxy' : 'direct');
                        return new Response(init.method === 'HEAD' || response.status === 204 ? null : new Uint8Array(bytes), {
                            status: response.status,
                            headers,
                        });
                    }
                    await response.body?.cancel();
                    attempts.push(`${new URL(route.source).hostname} ${route.proxy ? '代理' : '直连'} HTTP ${response.status}`);
                    if (response.status === 429) {
                        failureCode = 'RATE_LIMIT';
                        const raw = response.headers.get('retry-after');
                        const duration = raw && /^\d+$/u.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - Date.now() : 0;
                        // Long platform cooldowns belong to an explicit retry, not a sleeping UI operation.
                        if (duration > 30_000)
                            break;
                        if (Number.isFinite(duration))
                            retryDelay = Math.max(retryDelay, duration);
                    }
                    if (response.status !== 429 && response.status < 500)
                        break;
                }
                catch (error) {
                    signal.throwIfAborted();
                    if (error instanceof Error && 'code' in error) {
                        if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'LIMIT'].includes(String(error.code)))
                            throw error;
                        if (error.code === 'CHECKSUM') {
                            failureCode = 'CHECKSUM';
                            attempts.push(`${new URL(route.source).hostname} 校验失败`);
                            break;
                        }
                    }
                    if (error instanceof Error && error.message === '下载超过大小限制。') {
                        attempts.push(`${new URL(route.source).hostname} 下载超过大小限制`);
                        break;
                    }
                    attempts.push(`${new URL(route.source).hostname} ${route.proxy ? '代理' : '直连'}连接失败`);
                }
                if (attempt < 2)
                    await delay(retryDelay, undefined, { signal });
            }
        }
        throw Object.assign(new Error(`下载失败：${[...new Set(attempts)].join('；')}。请打开 Minecraft 下载与构建设置检测连接或调整代理。`), { code: failureCode });
    }
    /**
     * Java reads JVM proxy properties rather than HTTP_PROXY environment variables.
     * @param directFallback - Use direct transport only when automatic mode permits it.
     * @returns Child-only JVM options.
     */
    async javaEnvironment(directFallback = false) {
        const proxy = directFallback && this.settings.mode === 'auto'
            ? undefined
            : await this.proxy('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        const options = ['-Djava.net.useSystemProxies=false'];
        if (proxy) {
            const url = new URL(proxy);
            if (url.protocol === 'https:')
                throw new Error('Java 构建不支持 TLS 代理连接，请使用 VPN 的 HTTP／混合代理端口。');
            for (const protocol of ['http', 'https'])
                options.push(`-D${protocol}.proxyHost=${url.hostname}`, `-D${protocol}.proxyPort=${url.port || '80'}`);
            const bypass = [
                'localhost',
                '127.*',
                '[::1]',
                ...(this.settings.mode === 'auto'
                    ? ['*.bangbang93.com', '*.aliyun.com', '*.huaweicloud.com', '*.cloud.tencent.com']
                    : []),
            ];
            options.push(`-Dhttp.nonProxyHosts=${bypass.join('|')}`);
        }
        else
            options.push('-Dhttp.proxyHost=', '-Dhttps.proxyHost=', '-DsocksProxyHost=');
        return { JAVA_TOOL_OPTIONS: options.map(value => `"${value}"`).join(' ') };
    }
}
/** Per-host settings owner; async operations retain the configuration they started with. */
export class MinecraftNetwork {
    ctx;
    agents = new Map();
    successful = new Map();
    constructor(ctx) {
        this.ctx = ctx;
        ctx.effect(() => () => Promise.allSettled([...this.agents.values()].map(agent => agent.destroy())).then(() => { }), 'minecraft-network: connections');
        ctx.inject(['settings'], (host) => {
            host.settings.register(namespace, settingsSchema);
        });
    }
    /**
     * Read the effective preference without exposing proxy credentials.
     * @returns Validated network settings.
     */
    read() {
        return NetworkSettingsSchema.parse(this.ctx.get('settings')?.get(namespace) ?? {});
    }
    /**
     * Persist a validated user preference through the settings service.
     * @param input - Untrusted preference payload.
     * @returns Committed preference.
     */
    async save(input) {
        const value = NetworkSettingsSchema.parse(input);
        const settings = this.ctx.get('settings');
        if (!settings)
            throw new Error('宿主尚未提供设置存储。');
        await settings.update(namespace, value);
        this.successful.clear();
        return this.read();
    }
    /**
     * Start a task with immutable network settings and trusted launch proxy inputs.
     * @param task - Work retaining this operation context through asynchronous calls.
     * @returns The task result.
     */
    run(task) {
        const env = launchEnvironmentOf(this.ctx);
        const inherited = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
            .map(key => env.getFrom(key, ['process', 'user-env'])?.value)
            .find(Boolean);
        return scope.run(new NetworkOperation(this.read(), inherited, this.agents, this.successful), task);
    }
    /**
     * Probe representative metadata endpoints without downloading toolchains.
     * @param signal - Caller cancellation.
     * @returns Per-resource connection results and Java proxy compatibility.
     */
    async check(signal) {
        return this.run(async () => {
            const java = await networkJavaEnvironment().then(() => ({ name: 'Java 代理配置', ok: true, message: '可用于 Gradle 子进程' }), (error) => ({
                name: 'Java 代理配置',
                ok: false,
                message: error instanceof Error ? error.message : '代理不兼容',
            }));
            const endpoints = [
                ['Fabric', 'https://meta.fabricmc.net/v2/versions/game'],
                ['NeoForge', 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'],
                ['Java', 'https://api.adoptium.net/v3/info/available_releases'],
                ['Minecraft', 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'],
                ['Gradle', 'https://services.gradle.org/distributions/gradle-9.2.1-bin.zip.sha256'],
                ['Maven', 'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.pom'],
            ];
            const results = await Promise.all(endpoints.map(async ([name, url]) => {
                try {
                    const response = await networkFetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
                    await response.body?.cancel();
                    const path = response.headers.get('x-craftcode-route') === 'proxy' ? '代理' : '直连';
                    return {
                        name,
                        ok: true,
                        message: `连接成功：${response.headers.get('x-craftcode-source') ?? new URL(url).hostname}（${path}）`,
                    };
                }
                catch (error) {
                    return { name, ok: false, message: error instanceof Error ? error.message : '连接失败' };
                }
            }));
            return [java, ...results];
        });
    }
}
/**
 * Shared download boundary for Minecraft consumers inside an operation scope.
 * @param url - Official HTTPS resource URL.
 * @param init - HTTP options and cancellation.
 * @param maxBytes - Payload byte limit.
 * @param sha256 - Optional official digest.
 * @returns Verified bounded response.
 */
export function networkFetch(url, init, maxBytes, sha256) {
    return (scope.getStore() ?? new NetworkOperation({ mode: 'auto', proxyUrl: '' })).fetch(url, init, maxBytes, sha256);
}
/**
 * Share proxy policy with XMCL's file-transfer implementation without wrapping its retry loop.
 * @returns Shared proxy-aware dispatcher with bounded connections.
 * @returns Shared proxy-aware dispatcher with bounded connections.
 */
export function installerDispatcher() {
    return (scope.getStore() ?? new NetworkOperation({ mode: 'auto', proxyUrl: '' })).installerDispatcher();
}
/**
 * Stream a bounded artifact through the operation's routes; the sink owns verification and partial files.
 * @param url - Official HTTPS publication URL.
 * @param init - Request options and cancellation.
 * @param maxBytes - Maximum accepted output or response bytes.
 * @param sink - Streaming response consumer responsible for validation and commit.
 * @param headers - Fresh headers for each transfer attempt.
 */
export async function networkTransfer(url, init, maxBytes, sink, headers) {
    await (scope.getStore() ?? new NetworkOperation({ mode: 'auto', proxyUrl: '' })).fetch(url, init, maxBytes, undefined, sink, headers);
}
/**
 * Child-only proxy settings for the current Minecraft operation.
 * @param directFallback - Automatic-mode direct retry.
 * @returns JVM options for the next subprocess.
 */
export function networkJavaEnvironment(directFallback = false) {
    return (scope.getStore() ?? new NetworkOperation({ mode: 'auto', proxyUrl: '' })).javaEnvironment(directFallback);
}
/**
 * Explicit user transport choices never fall back to a different transport.
 * @returns Whether the current operation allows automatic transport selection.
 */
export function automaticMinecraftNetwork() {
    return (scope.getStore()?.settings.mode ?? 'auto') === 'auto';
}
/**
 * Only dependency transport failures qualify for an automatic build retry.
 * @param output - Captured Gradle failure output.
 * @returns Whether the output identifies a retryable network failure.
 */
export function isMinecraftNetworkFailure(output) {
    if (/Compilation failed|\bcompile(?:Java|Kotlin) FAILED|\berror: (?:cannot find symbol|incompatible types)|Build cancelled/iu.test(output))
        return false;
    if (/MalformedJsonException:[^\n]* path \$\.versions\[/u.test(output))
        return true;
    if (/net\.fabricmc\.loom\.util\.download\.DownloadException: Failed to download/u.test(output))
        return true;
    return (/UnknownHostException|ConnectException|SocketTimeoutException|Connection (?:timed out|reset|refused)/iu.test(output) ||
        /Read timed out|network is unreachable|No route to host|received status code (?:429|5\d\d)/iu.test(output) ||
        /Remote host terminated the handshake|SSL peer shut down incorrectly/iu.test(output) ||
        /PKIX path building failed|Failed download after \d+ attempts/iu.test(output));
}
/**
 * Owned init script uses Loom's published MirrorUtil extra properties, not project edits.
 * @param loader - Detected project loader.
 * @param officialOnly - Skip the application mirror script for an official-source retry.
 * @returns Gradle arguments referencing application-owned configuration.
 */
export async function networkGradleArguments(loader, officialOnly = false) {
    if (officialOnly || scope.getStore()?.settings.mode === 'proxy')
        return ['-Ddsh.bootstrap.officialOnly=true'];
    const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cache', 'minecraft-workbench', 'network');
    await mkdir(root, { recursive: true });
    const file = join(root, loader === 'fabric' ? 'fabric-v1.gradle' : 'maven-v1.gradle');
    const mirrors = "['https://maven.aliyun.com/repository/public', 'https://bmclapi2.bangbang93.com/maven']";
    const loom = loader === 'fabric'
        ? `
  target.ext.loom_libraries_base = 'https://bmclapi2.bangbang93.com/maven/'
  target.ext.loom_resources_base = 'https://bmclapi2.bangbang93.com/assets/'
  target.ext.loom_version_manifests = 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
  target.ext.loom_fabric_repository = 'https://bmclapi2.bangbang93.com/maven/'`
        : '';
    const script = `// CraftCode managed network configuration; no global Gradle changes.
gradle.beforeSettings { target ->${loom}
  ${mirrors}.each { address -> target.pluginManagement.repositories.maven { url = uri(address) } }
}
gradle.beforeProject { target ->${loom}
  ${mirrors}.each { address -> target.repositories.maven { url = uri(address) } }
}
`;
    if ((await readFile(file, 'utf8').catch(() => '')) !== script) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, script, { flag: 'wx' });
            await rename(temporary, file);
        }
        finally {
            await unlink(temporary).catch(() => { });
        }
    }
    return ['--init-script', file];
}
//# sourceMappingURL=network.js.map