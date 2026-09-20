import { networkFetch } from '@deepseek-ai/dsh-mc-workbench';
/** Online/cached version catalog resolution for the host-local wizard. */
import { access, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { delimiter, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { catalogEntryId, isCatalogEntry, isStableMinecraftVersion, isSupportedNeoForgeMinecraftVersion, jdkForMinecraft, } from "./validation.js";
/** Default catalog cache location; never touches global Gradle config. */
export function defaultCatalogCachePath() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(home, 'cache', 'minecraft-bootstrap', 'catalog.json');
}
/** Network timeout for one catalog request. */
export const CATALOG_TIMEOUT_MS = 20_000;
/** Overall online refresh budget; a cache or completed loader family wins after it expires. */
export const CATALOG_REFRESH_TIMEOUT_MS = 45_000;
/** A cache older than this is displayed as stale. */
export const CATALOG_STALE_MS = 24 * 60 * 60 * 1_000;
/** Bounded fallback pagination for the official NeoForge MDK organization. */
const GITHUB_MDK_REPOSITORIES_URL = 'https://api.github.com/orgs/NeoForgeMDKs/repos';
const GITHUB_MDK_PAGE_SIZE = 100;
const GITHUB_MDK_MAX_PAGES = 4;
/**
 * Wrapper recipes pinned to the current upstream templates.  Keeping these
 * values in the catalog (rather than letting a project pick a Gradle version)
 * makes the generated wrapper reproducible and avoids the removed 8.8 tag,
 * which no longer carries a wrapper JAR in the Gradle source repository.
 */
const FABRIC_GRADLE_JDK17 = {
    version: '8.14.5',
    sha256: '6f74b601422d6d6fc4e1f9a1ab6522f642c2fdcbc15ae33ebd30ba3d7198e854',
    wrapperSha256: '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172',
};
const FABRIC_GRADLE_JDK21 = {
    version: '9.5.1',
    sha256: 'bafc141b619ad6350fd975fc903156dd5c151998cc8b058e8c1044ab5f7b031f',
    wrapperSha256: '497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7',
};
const NEOFORGE_GRADLE_1202 = {
    version: '8.14.5',
    sha256: '6f74b601422d6d6fc4e1f9a1ab6522f642c2fdcbc15ae33ebd30ba3d7198e854',
    wrapperSha256: '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172',
};
const NEOFORGE_GRADLE_MODERN = {
    version: '9.2.1',
    sha256: '72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f',
    wrapperSha256: '423cb469ccc0ecc31f0e4e1c309976198ccb734cdcbb7029d4bda0f18f57e8d9',
};
/** Parse and filter Fabric Meta game versions without trusting the server. */
export function parseFabricGameVersions(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.flatMap((item) => {
            if (typeof item !== 'object' || item === null)
                return [];
            const row = item;
            return typeof row.version === 'string' && isStableMinecraftVersion(row.version, row.stable === true)
                ? [row.version]
                : [];
            // Newest first: the resolver only probes a bounded prefix and the wizard
            // uses the first matching entry as its default version.
        }))].sort((left, right) => compareMinecraftVersions(right, left));
}
/** Parse the loader endpoint into trusted primitive fields. */
export function parseFabricLoaderVersions(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((item) => {
        if (typeof item !== 'object' || item === null)
            return [];
        const row = item;
        const loader = row.loader?.version;
        const intermediary = row.intermediary?.version;
        if (typeof loader !== 'string' || row.loader?.stable !== true || typeof intermediary !== 'string')
            return [];
        return [{ loader, intermediary }];
    }).sort((left, right) => compareNumericVersions(right.loader, left.loader));
}
/** Parse Yarn mappings for one game version from Fabric Meta. */
export function parseFabricYarnVersions(value, minecraftVersion) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((item) => {
        if (typeof item !== 'object' || item === null)
            return [];
        const row = item;
        if (row.gameVersion !== minecraftVersion || typeof row.version !== 'string')
            return [];
        // Fabric marks Yarn builds as non-stable even for released game versions;
        // validate the coordinate shape instead of trusting that flag.
        const match = new RegExp(`^${escapeRegExp(minecraftVersion)}\\+build\\.(\\d+)$`, 'u').exec(row.version);
        return match === null ? [] : [row.version];
    }).sort((left, right) => {
        const leftBuild = Number(left.split('+build.')[1] ?? -1);
        const rightBuild = Number(right.split('+build.')[1] ?? -1);
        return rightBuild - leftBuild;
    });
}
/** Select the newest Fabric API publication that explicitly targets a game version. */
export function parseFabricApiVersion(xml, minecraftVersion) {
    const candidates = [...xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/gu)]
        .map(match => match[1])
        .filter((version) => version !== undefined
        && version.endsWith(`+${minecraftVersion}`)
        && !/(?:alpha|beta|rc|snapshot|pre)[-.]?/iu.test(version));
    return candidates.sort((a, b) => compareNumericVersions(a.split('+', 1)[0] ?? '', b.split('+', 1)[0] ?? '')).at(-1);
}
/** Parse NeoForge Maven metadata into stable game/loader pairs. */
export function parseNeoForgeMetadata(xml) {
    return parseNeoForgeVersions([...xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/gu)]
        .flatMap(match => match[1] === undefined ? [] : [match[1]]));
}
/** Parse the official Maven directory index when metadata.xml is unavailable. */
export function parseNeoForgeDirectoryIndex(html) {
    return parseNeoForgeVersions([...html.matchAll(/href=["'](?:\.\/)?([^"'/?#]+)\/["']/giu)]
        .flatMap(match => match[1] === undefined ? [] : [decodeURIComponentSafe(match[1])]));
}
/** Parse the pinned NeoGradle plugin and wrapper recipe from an official MDK. */
export function parseNeoForgeMdkRecipe(buildGradle, wrapperProperties) {
    const pluginVersion = /id\s+['"]net\.neoforged\.gradle\.userdev['"]\s+version\s+['"](\d+(?:\.\d+){1,3})['"]/u
        .exec(buildGradle)?.[1];
    const gradleVersion = /distributionUrl=.*gradle-(\d+(?:\.\d+){1,3})-bin\.zip/mu.exec(wrapperProperties)?.[1];
    if (pluginVersion === undefined || gradleVersion === undefined || gradleRecipe(gradleVersion) === undefined)
        return undefined;
    return { pluginVersion, gradleVersion };
}
/** Extract supported NeoGradle MDK game lines from the official GitHub organization. */
export function parseNeoForgeMdkRepositories(value) {
    if (!Array.isArray(value))
        return [];
    const versions = value.flatMap((item) => {
        if (typeof item !== 'object' || item === null)
            return [];
        const name = item.name;
        const match = typeof name === 'string' ? /^MDK-(1\.\d+(?:\.\d+)?)-NeoGradle$/u.exec(name) : null;
        return match?.[1] !== undefined && isSupportedNeoForgeMinecraftVersion(match[1])
            ? [match[1]]
            : [];
    });
    return [...new Set(versions)].sort((left, right) => compareMinecraftVersions(right, left));
}
/** Read the stable NeoForge coordinate pinned by an official MDK. */
export function parseNeoForgeMdkLoader(properties, minecraftVersion) {
    const loaderVersion = /^neo_version\s*=\s*(\d+(?:\.\d+){2,3})\s*$/mu.exec(properties)?.[1];
    if (loaderVersion === undefined)
        return undefined;
    return parseNeoForgeVersions([loaderVersion])[0]?.minecraftVersion === minecraftVersion ? loaderVersion : undefined;
}
function parseNeoForgeVersions(versions) {
    const out = [];
    const seen = new Set();
    for (const loaderVersion of versions) {
        if (/(?:alpha|beta|rc|snapshot)/iu.test(loaderVersion))
            continue;
        const parts = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/u.exec(loaderVersion);
        if (parts === null)
            continue;
        const major = Number(parts[1]);
        const minor = Number(parts[2]);
        // NeoForge's first two components mirror the Minecraft minor/patch line:
        // 20.1 => 1.20.1, 20.4 => 1.20.4, 21.1 => 1.21.1.
        // NeoForge's 21.0.x artifacts target the base Minecraft release named
        // `1.21`; later 21.1.x artifacts target `1.21.1`, etc.
        const minecraftVersion = minor === 0 ? `1.${String(major)}` : `1.${String(major)}.${String(minor)}`;
        // NeoForge did not publish a supported 20.1 MDK line. Do not infer one
        // from a similarly-shaped artifact or present it as a selectable target.
        if (!isSupportedNeoForgeMinecraftVersion(minecraftVersion))
            continue;
        const key = `${minecraftVersion}:${loaderVersion}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({ minecraftVersion, loaderVersion });
    }
    return out.sort((a, b) => compareMinecraftVersions(b.minecraftVersion, a.minecraftVersion)
        || compareNumericVersions(b.loaderVersion, a.loaderVersion));
}
/** Build a deterministic Fabric entry from the API response. */
export function fabricEntry(minecraftVersion, loaderVersion, intermediary, yarn, apiVersion = `0.102.0+${minecraftVersion}`) {
    const requiredJdk = jdkForMinecraft(minecraftVersion) ?? 21;
    const gradle = requiredJdk === 17 ? FABRIC_GRADLE_JDK17 : FABRIC_GRADLE_JDK21;
    return {
        entryId: catalogEntryId('fabric', minecraftVersion, loaderVersion),
        loader: 'fabric', minecraftVersion, loaderVersion,
        mappingsVersion: yarn || intermediary, apiVersion,
        // Loom 1.9.x is the last Java 17-compatible line; newer Minecraft lines
        // use the current remap plugin and its Gradle 9 recipe.
        pluginVersion: requiredJdk === 17 ? '1.9.2' : '1.17.20',
        gradleVersion: gradle.version, gradleSha256: gradle.sha256, wrapperSha256: gradle.wrapperSha256,
        requiredJdk, stable: true,
    };
}
/** Build a deterministic NeoForge entry. */
export function neoForgeEntry(minecraftVersion, loaderVersion, recipe) {
    if (!isSupportedNeoForgeMinecraftVersion(minecraftVersion)) {
        throw new Error(`unsupported NeoForge Minecraft version: ${minecraftVersion}`);
    }
    const defaultGradle = minecraftVersion === '1.20.2' ? NEOFORGE_GRADLE_1202 : NEOFORGE_GRADLE_MODERN;
    const gradle = gradleRecipe(recipe?.gradleVersion ?? defaultGradle.version) ?? defaultGradle;
    return {
        entryId: catalogEntryId('neoforge', minecraftVersion, loaderVersion),
        loader: 'neoforge', minecraftVersion, loaderVersion,
        mappingsVersion: 'official', apiVersion: 'neoforge',
        // The NeoGradle MDK is the common, published recipe across the supported
        // lines.  Only the 1.20.2 MDK pins the older plugin; newer MDKs use 7.1.38.
        // Keeping one plugin family avoids silently mixing a ModDev recipe with a
        // userdev dependency block when the catalog is refreshed.
        pluginVersion: recipe?.pluginVersion ?? (minecraftVersion === '1.20.2' ? '7.0.116' : '7.1.38'),
        gradleVersion: gradle.version, gradleSha256: gradle.sha256, wrapperSha256: gradle.wrapperSha256,
        requiredJdk: jdkForMinecraft(minecraftVersion) ?? 21, stable: true,
    };
}
/** Keep one newest stable entry per loader/game line. */
export function normalizeCatalogEntries(entries) {
    const sorted = [...entries]
        .filter(entry => isCatalogEntry(entry)
        && isStableMinecraftVersion(entry.minecraftVersion)
        && (entry.loader !== 'neoforge' || isSupportedNeoForgeMinecraftVersion(entry.minecraftVersion))
        && isTrustedCatalogRecipe(entry))
        .sort((a, b) => compareMinecraftVersions(b.minecraftVersion, a.minecraftVersion)
        || compareNumericVersions(b.loaderVersion, a.loaderVersion)
        || a.loader.localeCompare(b.loader));
    const seen = new Set();
    const out = [];
    for (const entry of sorted) {
        const key = `${entry.loader}:${entry.minecraftVersion}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(entry);
    }
    return out.sort((a, b) => compareMinecraftVersions(b.minecraftVersion, a.minecraftVersion)
        || a.loader.localeCompare(b.loader));
}
/** Resolver with online-first/cache-fallback semantics. */
export class MinecraftCatalogResolver {
    cachePath;
    doFetch;
    now;
    probeJava;
    refreshTimeoutMs;
    constructor(options = {}) {
        this.cachePath = options.cachePath ?? defaultCatalogCachePath();
        this.doFetch = options.fetch ?? networkFetch;
        this.now = options.now ?? (() => new Date());
        this.probeJava = options.probeJava ?? probeJava;
        this.refreshTimeoutMs = options.refreshTimeoutMs ?? CATALOG_REFRESH_TIMEOUT_MS;
    }
    /**
     * Resolve an online catalog, merging successful loader families into the cache.
     * @param signal - Caller cancellation.
     * @param refresh - False permits a fresh cache without an online refresh.
     * @returns Available versions with cache provenance and Java status.
     */
    async load(signal, refresh = true) {
        const java = await this.probeJava(signal).catch((error) => ({
            available: false,
            message: error instanceof Error ? error.message : String(error),
        }));
        const available = await readCache(this.cachePath);
        if (!refresh && available && this.now().getTime() - Date.parse(available.fetchedAt) < CATALOG_STALE_MS) {
            return { entries: available.entries, fetchedAt: available.fetchedAt, cached: true, stale: false, java };
        }
        try {
            const entries = await this.fetchOnlineWithinBudget(signal);
            signal?.throwIfAborted();
            const fetchedAt = this.now().toISOString();
            const resolvedLoaders = new Set(entries.map(entry => entry.loader));
            if (resolvedLoaders.size < 2) {
                const missing = ['fabric', 'neoforge'].filter(loader => !resolvedLoaders.has(loader));
                const partialError = `online catalog did not resolve ${missing.join(' and ')}`;
                const cached = await readCache(this.cachePath);
                if (cached !== undefined) {
                    const age = this.now().getTime() - Date.parse(cached.fetchedAt);
                    const merged = normalizeCatalogEntries([...entries, ...cached.entries.filter(entry => !resolvedLoaders.has(entry.loader))]);
                    // Keep the oldest freshness bound until both loader families refresh.
                    await writeCache(this.cachePath, { format: 1, entries: merged, fetchedAt: cached.fetchedAt });
                    return {
                        entries: merged, fetchedAt: cached.fetchedAt, cached: true,
                        stale: !Number.isFinite(age) || age > CATALOG_STALE_MS, java, error: partialError,
                    };
                }
                await writeCache(this.cachePath, { format: 1, fetchedAt, entries });
                return { entries, fetchedAt, cached: false, stale: false, java, error: partialError };
            }
            let cacheError;
            try {
                await writeCache(this.cachePath, { format: 1, fetchedAt, entries });
            }
            catch (error) {
                cacheError = error instanceof Error ? error.message : String(error);
            }
            return {
                entries, fetchedAt, cached: false, stale: false, java,
                ...(cacheError === undefined ? {} : { error: `catalog cache unavailable: ${cacheError}` }),
            };
        }
        catch (error) {
            const cached = await readCache(this.cachePath);
            if (cached !== undefined) {
                const age = this.now().getTime() - Date.parse(cached.fetchedAt);
                return {
                    entries: cached.entries, fetchedAt: cached.fetchedAt, cached: true,
                    stale: !Number.isFinite(age) || age > CATALOG_STALE_MS, java,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
            return { entries: [], cached: false, stale: true, java, error: error instanceof Error ? error.message : String(error) };
        }
    }
    /**
     * Return verified cached entries immediately, without waiting for an online refresh.
     * @returns Usable cached catalog, or undefined when no valid cache exists.
     */
    async cached() {
        const cached = await readCache(this.cachePath);
        if (!cached)
            return undefined;
        const age = this.now().getTime() - Date.parse(cached.fetchedAt);
        return { entries: cached.entries, fetchedAt: cached.fetchedAt, cached: true,
            stale: !Number.isFinite(age) || age > CATALOG_STALE_MS, java: { available: false, message: '准备时检查 Java' } };
    }
    async fetchOnlineWithinBudget(signal) {
        const controller = new AbortController();
        const forwardAbort = () => { controller.abort(signal?.reason); };
        signal?.addEventListener('abort', forwardAbort, { once: true });
        const timer = setTimeout(() => {
            controller.abort(new Error('catalog refresh timed out'));
        }, this.refreshTimeoutMs);
        try {
            return await this.fetchOnline(controller.signal);
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', forwardAbort);
        }
    }
    async fetchOnline(signal) {
        const [fabricResult, neoForgeResult] = await Promise.allSettled([
            this.fetchFabricEntries(signal),
            this.fetchNeoForgeEntries(signal),
        ]);
        const fabric = fabricResult.status === 'fulfilled' ? fabricResult.value : [];
        const neoForge = neoForgeResult.status === 'fulfilled' ? neoForgeResult.value : [];
        const normalized = normalizeCatalogEntries([...fabric, ...neoForge]);
        if (normalized.length === 0) {
            const messages = [fabricResult, neoForgeResult].flatMap(result => result.status === 'rejected'
                ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
                : []);
            throw new Error(messages.length === 0
                ? 'no stable Fabric or NeoForge combinations were resolved'
                : `no stable Fabric or NeoForge combinations were resolved: ${messages.join('; ')}`);
        }
        return normalized;
    }
    async fetchFabricEntries(signal) {
        // BMCLAPI is preferred for Chinese networks, but an empty/malformed mirror
        // response is treated as a miss and falls back to the authoritative Meta
        // endpoint just like a transport failure.
        let gameVersions = parseFabricGameVersions(await this.getJson('https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/game', signal).catch(() => undefined));
        if (gameVersions.length === 0) {
            gameVersions = parseFabricGameVersions(await this.getJson('https://meta.fabricmc.net/v2/versions/game', signal));
        }
        const apiMetadata = await this.getFabricApiMetadata(signal);
        const resolved = await mapWithConcurrency(gameVersions.slice(0, 64), 8, async (minecraftVersion) => {
            const apiVersion = parseFabricApiVersion(apiMetadata, minecraftVersion);
            if (apiVersion === undefined)
                return undefined;
            const raw = await this.getJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`, signal)
                .catch(() => undefined);
            const latest = parseFabricLoaderVersions(raw)[0];
            if (latest === undefined)
                return undefined;
            const yarn = await this.getFabricYarnVersion(minecraftVersion, signal);
            // Do not fall back to a fabricated Yarn coordinate: the loader endpoint
            // does not include mappings, and an unresolved mapping cannot build.
            return yarn === undefined
                ? undefined
                : fabricEntry(minecraftVersion, latest.loader, latest.intermediary, yarn, apiVersion);
        });
        return resolved.filter((entry) => entry !== undefined);
    }
    async fetchNeoForgeEntries(signal) {
        const neoXml = await this.getText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', signal).catch(() => undefined);
        let neoRows = neoXml === undefined ? [] : parseNeoForgeMetadata(neoXml);
        if (neoRows.length === 0) {
            const neoIndex = await this.getText('https://maven.neoforged.net/releases/net/neoforged/neoforge/', signal).catch(() => undefined);
            neoRows = neoIndex === undefined ? [] : parseNeoForgeDirectoryIndex(neoIndex);
        }
        const publishedByMinecraft = new Map();
        for (const row of neoRows) {
            const published = publishedByMinecraft.get(row.minecraftVersion) ?? new Set();
            published.add(row.loaderVersion);
            publishedByMinecraft.set(row.minecraftVersion, published);
        }
        let minecraftVersions = [...publishedByMinecraft.keys()]
            .sort((left, right) => compareMinecraftVersions(right, left));
        if (minecraftVersions.length === 0) {
            const repositories = await this.fetchNeoForgeMdkRepositories(signal);
            minecraftVersions = parseNeoForgeMdkRepositories(repositories);
        }
        const resolved = await mapWithConcurrency(minecraftVersions, 6, minecraftVersion => this.resolveNeoForgeMdk(minecraftVersion, publishedByMinecraft.get(minecraftVersion), signal));
        return resolved.filter((entry) => entry !== undefined);
    }
    async resolveNeoForgeMdk(minecraftVersion, publishedLoaderVersions, signal) {
        const repository = `https://raw.githubusercontent.com/NeoForgeMDKs/MDK-${encodeURIComponent(minecraftVersion)}-NeoGradle/main`;
        const metadataFile = minecraftVersion === '1.20.2' || minecraftVersion === '1.20.4'
            ? 'mods.toml'
            : 'neoforge.mods.toml';
        const [buildGradle, wrapperProperties, metadata, gradleProperties] = await Promise.all([
            this.getText(`${repository}/build.gradle`, signal),
            this.getText(`${repository}/gradle/wrapper/gradle-wrapper.properties`, signal),
            this.getText(`${repository}/src/main/resources/META-INF/${metadataFile}`, signal),
            this.getText(`${repository}/gradle.properties`, signal),
        ]).catch(() => ['', '', '', '']);
        const recipe = parseNeoForgeMdkRecipe(buildGradle, wrapperProperties);
        const loaderVersion = parseNeoForgeMdkLoader(gradleProperties, minecraftVersion);
        if (recipe === undefined || loaderVersion === undefined || !metadata.includes('[[mods]]'))
            return undefined;
        if (publishedLoaderVersions !== undefined && !publishedLoaderVersions.has(loaderVersion))
            return undefined;
        return neoForgeEntry(minecraftVersion, loaderVersion, recipe);
    }
    async getJson(url, signal) {
        const response = await this.request(url, signal);
        if (!response.ok)
            throw new Error(`catalog request failed (${response.status})`);
        return boundedCatalogPromise(() => response.json(), signal);
    }
    /**
     * Read the official MDK repository list through a small, deterministic page
     * window.  A failed later page keeps entries already collected, while the
     * hard page/row cap prevents an unbounded GitHub response from consuming the
     * catalog refresh deadline.
     */
    async fetchNeoForgeMdkRepositories(signal) {
        const repositories = [];
        for (let page = 1; page <= GITHUB_MDK_MAX_PAGES; page += 1) {
            const suffix = page === 1 ? '' : `&page=${String(page)}`;
            const raw = await this.getJson(`${GITHUB_MDK_REPOSITORIES_URL}?per_page=${String(GITHUB_MDK_PAGE_SIZE)}&type=public${suffix}`, signal).catch(() => undefined);
            if (!Array.isArray(raw))
                break;
            const rows = raw;
            repositories.push(...rows.slice(0, GITHUB_MDK_PAGE_SIZE));
            if (repositories.length >= GITHUB_MDK_PAGE_SIZE * GITHUB_MDK_MAX_PAGES
                || rows.length < GITHUB_MDK_PAGE_SIZE)
                break;
        }
        return repositories;
    }
    async getText(url, signal) {
        const response = await this.request(url, signal);
        if (!response.ok)
            throw new Error(`catalog request failed (${response.status})`);
        return boundedCatalogPromise(() => response.text(), signal);
    }
    async getFabricYarnVersion(minecraftVersion, signal) {
        const path = encodeURIComponent(minecraftVersion);
        const urls = [
            `https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/yarn/${path}`,
            `https://meta.fabricmc.net/v2/versions/yarn/${path}`,
        ];
        for (const url of urls) {
            const raw = await this.getJson(url, signal).catch(() => undefined);
            const yarn = parseFabricYarnVersions(raw, minecraftVersion)[0];
            if (yarn !== undefined)
                return yarn;
        }
        return undefined;
    }
    async getFabricApiMetadata(signal) {
        const urls = [
            'https://maven.aliyun.com/repository/public/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml',
            'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml',
        ];
        for (const url of urls) {
            const xml = await this.getText(url, signal).catch(() => '');
            if (/<version>\s*[^<\s]+\s*<\/version>/u.test(xml))
                return xml;
        }
        return '';
    }
    async request(url, signal) {
        const controller = new AbortController();
        const onAbort = () => { controller.abort(signal?.reason); };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            return await boundedCatalogPromise(() => this.doFetch(url, { signal: controller.signal }), signal, controller);
        }
        finally {
            signal?.removeEventListener('abort', onAbort);
        }
    }
}
/** Bound adapters even when an injected fetch implementation ignores AbortSignal. */
function boundedCatalogPromise(factory, signal, controller) {
    return new Promise((resolvePromise, reject) => {
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            callback();
        };
        const abort = () => {
            const reason = signal?.reason;
            controller?.abort(reason);
            finish(() => { reject(abortError(reason)); });
        };
        const timer = setTimeout(() => {
            const error = new Error('catalog request timed out');
            controller?.abort(error);
            finish(() => { reject(error); });
        }, CATALOG_TIMEOUT_MS);
        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(factory).then((value) => { finish(() => { resolvePromise(value); }); }, (error) => {
            const reason = error instanceof Error ? error : new Error(String(error));
            finish(() => { reject(reason); });
        });
    });
}
function abortError(reason) {
    return reason instanceof Error ? reason : new DOMException('The operation was aborted', 'AbortError');
}
function gradleRecipe(version) {
    if (version === NEOFORGE_GRADLE_1202.version)
        return NEOFORGE_GRADLE_1202;
    if (version === NEOFORGE_GRADLE_MODERN.version)
        return NEOFORGE_GRADLE_MODERN;
    return undefined;
}
/** Accept only recipes derived from this build's checksummed template policy. */
function isTrustedCatalogRecipe(entry) {
    if (entry.loader === 'fabric') {
        const expected = entry.requiredJdk === 17 ? FABRIC_GRADLE_JDK17 : FABRIC_GRADLE_JDK21;
        const pluginVersion = entry.requiredJdk === 17 ? '1.9.2' : '1.17.20';
        return entry.pluginVersion === pluginVersion
            && entry.gradleVersion === expected.version
            && entry.gradleSha256 === expected.sha256
            && entry.wrapperSha256 === expected.wrapperSha256;
    }
    const expected = entry.minecraftVersion === '1.20.2' ? NEOFORGE_GRADLE_1202 : NEOFORGE_GRADLE_MODERN;
    const pluginVersion = entry.minecraftVersion === '1.20.2' ? '7.0.116' : '7.1.38';
    return entry.pluginVersion === pluginVersion
        && entry.gradleVersion === expected.version
        && entry.gradleSha256 === expected.sha256
        && entry.wrapperSha256 === expected.wrapperSha256;
}
async function mapWithConcurrency(values, concurrency, mapper) {
    const results = new Array(values.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < values.length) {
            const index = cursor;
            cursor += 1;
            const value = values[index];
            if (value !== undefined)
                results[index] = await mapper(value);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
    return results;
}
/** Probe Java without a shell and report the major version from stderr/stdout. */
export async function probeJava(signal) {
    const executable = await findJavaExecutable();
    if (executable === undefined)
        return { available: false, message: '未在 PATH 中找到 Java' };
    return await new Promise((resolvePromise) => {
        if (signal?.aborted) {
            resolvePromise({ available: false, message: 'Java 检查已取消' });
            return;
        }
        const child = spawn(executable, ['-version'], {
            shell: false,
            windowsHide: true,
            env: cleanProbeEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolvePromise(result);
        };
        const timer = setTimeout(() => {
            child.kill();
            finish({ available: false, message: 'Java 检查超时' });
        }, CATALOG_TIMEOUT_MS);
        const abort = () => {
            child.kill();
            finish({ available: false, message: 'Java 检查已取消' });
        };
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-4_096); });
        child.stderr.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-4_096); });
        child.once('error', (error) => { finish({ available: false, message: error.message }); });
        child.once('close', (code) => {
            if (code !== 0) {
                finish({ available: false, message: output.trim().slice(-512) });
                return;
            }
            const major = parseJavaMajor(output);
            finish({ available: true, ...(major === undefined ? {} : { version: major }), executable, message: output.trim().slice(0, 512) });
        });
    });
}
async function findJavaExecutable() {
    const names = process.platform === 'win32' ? ['java.exe'] : ['java'];
    for (const rawDirectory of (process.env.PATH ?? '').split(delimiter)) {
        const directory = rawDirectory.trim().replace(/^"|"$/gu, '');
        if (directory === '')
            continue;
        for (const name of names) {
            const candidate = join(resolve(directory), name);
            if (!await access(candidate, fsConstants.X_OK).then(() => true, () => false))
                continue;
            return await realpath(candidate).catch(() => candidate);
        }
    }
    return undefined;
}
/** Avoid inherited runtime-injection switches while probing Java. */
function cleanProbeEnv() {
    const blocked = new Set([
        'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', '_JAVA_OPTIONS',
        'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', 'JAVA_HOME', 'JDK_HOME',
        'GRADLE_OPTS', 'MAVEN_OPTS',
        'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
    ]);
    const blockedPrefixes = ['TS_NODE_'];
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !blocked.has(key) && !blockedPrefixes.some(prefix => key.startsWith(prefix)))
            env[key] = value;
    }
    return env;
}
/** Parse `java -version` output, including legacy `1.8.0` notation. */
export function parseJavaMajor(output) {
    const match = /version\s+["'](?:1\.)?(\d+)/iu.exec(output);
    return match === null ? undefined : Number(match[1]);
}
async function readCache(path) {
    try {
        if (await hasSymlinkComponent(path))
            return undefined;
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (parsed.format !== 1 || typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.entries))
            return undefined;
        const entries = parsed.entries.filter(entry => isCatalogEntry(entry)
            && (entry.loader !== 'neoforge' || isSupportedNeoForgeMinecraftVersion(entry.minecraftVersion))
            && isTrustedCatalogRecipe(entry));
        if (entries.length === 0)
            return undefined;
        return { format: 1, fetchedAt: parsed.fetchedAt, entries: normalizeCatalogEntries(entries) };
    }
    catch {
        return undefined;
    }
}
async function writeCache(path, cache) {
    const directory = dirname(resolve(path));
    await ensureCacheDirectory(directory);
    const existing = await lstat(path).catch(() => undefined);
    if (existing?.isSymbolicLink())
        throw new Error('catalog cache path cannot be a symbolic link');
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8' });
        if (await hasSymlinkComponent(directory))
            throw new Error('catalog cache directory changed to a symbolic link');
        await rename(temporary, path);
    }
    finally {
        // A failed rename should not leave an apparently valid temporary catalog
        // that a later process might accidentally treat as the cache.
        await unlink(temporary).catch(() => { });
    }
}
async function hasSymlinkComponent(path) {
    const absolute = resolve(path);
    const root = parse(absolute).root;
    let current = root;
    for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
        current = join(current, part);
        const info = await lstat(current).catch(() => undefined);
        if (info === undefined)
            return false;
        if (info.isSymbolicLink())
            return true;
    }
    return false;
}
async function ensureCacheDirectory(directory) {
    const absolute = resolve(directory);
    const root = parse(absolute).root;
    let current = root;
    for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
        current = join(current, part);
        const before = await lstat(current).catch(() => undefined);
        if (before === undefined) {
            try {
                await mkdir(current, { recursive: false });
            }
            catch (error) {
                if (error?.code !== 'EEXIST')
                    throw error;
            }
        }
        const after = await lstat(current).catch(() => undefined);
        if (after === undefined || !after.isDirectory() || after.isSymbolicLink()) {
            throw new Error('catalog cache directory cannot contain a symbolic link or non-directory');
        }
    }
}
function compareMinecraftVersions(left, right) {
    return compareNumericVersions(left.replace(/^1\./u, ''), right.replace(/^1\./u, ''));
}
function compareNumericVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const delta = (a[i] ?? 0) - (b[i] ?? 0);
        if (delta !== 0)
            return delta;
    }
    return 0;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
//# sourceMappingURL=catalog.js.map