/** Exact-version installation and launch arguments for isolated local test instances. */
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, delimiter, resolve } from 'node:path';
import { MinecraftFolder, Version, LaunchPrecheck, generateArguments } from '@xmcl/core';
import { installVersionTask, installDependenciesTask, installLibrariesTask, installNeoForgedTask, installFabric, } from '@xmcl/installer';
import { z } from 'zod';
import { cacheRoot } from "./environment.js";
import { installerDispatcher, networkFetch, minecraftDownloadSources, networkJavaEnvironment } from "./network.js";
import { projectPath } from "./files.js";
let cacheQueue = Promise.resolve();
/**
 * Install an exact validated build target using the existing operation's cancellation and process owner.
 * @param cwd - Absolute project root.
 * @param artifact - Accepted publication and pinned loader identity.
 * @param side - Requested local client or server.
 * @param java - Selected JVM executable or major required by this operation.
 * @param controller - Owning lifecycle cancellation controller.
 * @param runner - Mounted process runner preserving the host shell policy.
 * @param output - Awaited retained-log sink.
 * @param progress - Incremental received and total bytes callback.
 * @returns Isolated directory and exact Java launch arguments.
 */
export async function prepareInstance(cwd, artifact, side, java, controller, runner, output, progress) {
    const { signal } = controller;
    const prior = cacheQueue;
    let release;
    cacheQueue = new Promise((resolve) => {
        release = resolve;
    });
    const processes = [];
    const run = async (task) => {
        signal.throwIfAborted();
        let cancellation;
        const abort = () => {
            cancellation = task.cancel().catch(() => { });
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
            const result = await task.startAndWait({
                onUpdate: () => {
                    progress(task.progress, task.total || undefined);
                },
            });
            signal.throwIfAborted();
            return result;
        }
        catch (error) {
            if (error instanceof AggregateError) {
                const causes = error.errors.map((value) => value instanceof Error
                    ? `${value.name}: ${'code' in value ? String(value.code) : value.message.replace(/https?:\/\/[^\s]+/gu, '[下载地址]')}`
                    : '安装传输失败');
                const disk = error.errors.find((value) => value instanceof Error &&
                    'code' in value &&
                    ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO'].includes(String(value.code)));
                throw Object.assign(new Error(`安装失败：${[...new Set(causes)].slice(0, 3).join('；')}${causes.length > 3 ? `；另有 ${causes.length - 3} 项失败` : ''}`), {
                    code: disk?.code ??
                        (error.errors.some((value) => value instanceof Error && value.name === 'ChecksumNotMatchError')
                            ? 'CHECKSUM'
                            : 'NETWORK'),
                });
            }
            throw error;
        }
        finally {
            signal.removeEventListener('abort', abort);
            await cancellation;
        }
    };
    try {
        await prior;
        signal.throwIfAborted();
        const root = join(cacheRoot(), 'game');
        await mkdir(root, { recursive: true });
        const folder = MinecraftFolder.from(root);
        const fetcher = (url, init) => networkFetch(url, { ...init, signal });
        const manifest = z
            .object({ versions: z.array(z.object({ id: z.string(), url: z.url() })) })
            .parse(await (await fetcher('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json());
        const metadata = manifest.versions.find(row => row.id === artifact.minecraft);
        if (!metadata)
            throw new Error(`官方版本列表没有 Minecraft ${artifact.minecraft}。`);
        const options = {
            // XMCL pins an older Undici 7 declaration; both consume the stable dispatch protocol.
            side,
            dispatcher: (await installerDispatcher()),
            fetch: fetcher,
            json: meta => minecraftDownloadSources(meta.url),
            client: (version) => {
                if (!version.downloads.client)
                    throw new Error('官方元数据缺少客户端。');
                return minecraftDownloadSources(version.downloads.client.url);
            },
            server: (version) => {
                if (!version.downloads.server)
                    throw new Error('官方元数据缺少服务端。');
                return minecraftDownloadSources(version.downloads.server.url);
            },
            libraryHost: library => (library.download.url ? minecraftDownloadSources(library.download.url) : undefined),
            assetsHost: ['https://bmclapi2.bangbang93.com/assets', 'https://resources.download.minecraft.net'],
            assetsDownloadConcurrency: 4,
            librariesDownloadConcurrency: 4,
        };
        await output(`安装 Minecraft ${artifact.minecraft} / ${artifact.loader} ${artifact.loaderVersion} (${side})\n`);
        await run(installVersionTask(metadata, folder, options));
        let versionId;
        if (artifact.loader === 'fabric') {
            versionId = await installFabric({
                minecraftVersion: artifact.minecraft,
                version: artifact.loaderVersion,
                minecraft: folder,
                side,
                fetch: fetcher,
                signal,
            });
        }
        else {
            const env = await networkJavaEnvironment();
            versionId = await run(installNeoForgedTask('neoforge', artifact.loaderVersion, folder, {
                ...options,
                java,
                spawn: (command, args = []) => {
                    // XMCL consumes only stdio and lifecycle events; the workbench owns the actual process tree.
                    const child = new ChildProcess();
                    child.stdout = new PassThrough();
                    child.stderr = new PassThrough();
                    child.kill = () => {
                        controller.abort(new Error('安装已取消。'));
                        return true;
                    };
                    const done = runner({
                        cwd: root,
                        argv: [command, ...args],
                        signal,
                        env,
                        output: async (text, stream) => {
                            child[stream]?.emit('data', text);
                            await output(text);
                        },
                    }).then((result) => {
                        child.emit('close', result.exitCode);
                    }, (error) => {
                        child.emit('error', error);
                    });
                    processes.push(done);
                    return child;
                },
            }));
        }
        const relative = `.dsh/instances/${artifact.loader}-${artifact.minecraft}-${artifact.loaderVersion}/${side}`;
        const directory = await projectPath(cwd, relative, true);
        await mkdir(directory, { recursive: true });
        let argv;
        if (side === 'client') {
            const version = await Version.parse(folder, versionId);
            await run(installDependenciesTask(version, options));
            const launch = {
                gamePath: directory,
                resourcePath: root,
                javaPath: java,
                version,
                gameProfile: { name: 'CraftCodeTest', id: '7be2d732fc9934b8be8e026f76a35360' },
                accessToken: '0',
                userType: 'legacy',
                launcherName: 'CraftCode',
                maxMemory: 2048,
                nativeRoot: join(directory, 'natives'),
            };
            await LaunchPrecheck.checkNatives(folder, version, launch);
            await LaunchPrecheck.linkAssets(folder, version, launch);
            argv = await generateArguments(launch);
        }
        else {
            const text = await readFile(folder.getVersionServerJson(versionId), 'utf8');
            const version = Version.resolve(folder, [Version.normalizeVersionJson(text, root)]);
            await run(installLibrariesTask(version, options));
            const libraries = version.libraries
                .filter(lib => !lib.isNative)
                .map(lib => folder.getLibraryByPath(lib.download.path));
            const classpath = [...libraries, folder.getVersionJar(artifact.minecraft, 'server')].join(delimiter);
            const replacements = {
                library_directory: folder.libraries,
                classpath_separator: delimiter,
                classpath,
            };
            const jvm = version.arguments.jvm.map((arg) => {
                if (typeof arg !== 'string')
                    throw new Error('服务端 JVM 启动规则尚未支持。');
                return arg
                    .replace(/\$\{([^}]+)\}/gu, (_, key) => {
                    const replacement = replacements[key];
                    if (replacement === undefined)
                        throw new Error(`无法解析服务端参数：${key}`);
                    return replacement;
                })
                    .replace(/(^|[;:=])libraries[\\/]/gu, `$1${folder.libraries.replaceAll('\\', '/')}/`);
            });
            const game = version.arguments.game.map((arg) => {
                if (typeof arg !== 'string')
                    throw new Error('服务端游戏启动规则尚未支持。');
                return arg;
            });
            argv = [
                java,
                '-Xmx2G',
                ...jvm,
                ...(jvm.includes('-cp') || jvm.includes('--class-path') ? [] : ['-cp', classpath]),
                version.mainClass,
                ...game,
                'nogui',
            ];
            const properties = join(directory, 'server.properties');
            const priorProperties = await readFile(properties, 'utf8').catch((error) => {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                    return '';
                throw error;
            });
            const managed = {
                'server-ip': '127.0.0.1',
                'online-mode': 'false',
                'enable-query': 'false',
                'enable-rcon': 'false',
            };
            const lines = priorProperties
                .split(/\r?\n/u)
                .filter(line => !Object.keys(managed).some(key => line.startsWith(key + '=')));
            await writeFile(properties, [...lines, ...Object.entries(managed).map(([key, value]) => `${key}=${value}`), ''].join('\n'));
            const eula = join(directory, 'eula.txt');
            await writeFile(eula, '# https://www.minecraft.net/eula\neula=false\n', { flag: 'wx' }).catch((error) => {
                if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            });
        }
        signal.throwIfAborted();
        if (!argv[0] || resolve(argv[0]) !== resolve(java))
            throw new Error('安装库未返回预期 Java 启动命令。');
        return { directory, relative, version: versionId, argv };
    }
    finally {
        await Promise.allSettled(processes);
        release();
    }
}
//# sourceMappingURL=instances.js.map