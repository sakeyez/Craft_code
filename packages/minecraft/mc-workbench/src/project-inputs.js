/** Stable project input inventory, shared by artifact evidence and project recovery. */
import { readdir, lstat } from 'node:fs/promises';
import { hash, projectPath } from "./files.js";
import { fileDigest } from "./transfer.js";
const excluded = new Set([
    '.git',
    '.gradle',
    '.idea',
    '.vscode',
    'build',
    'out',
    'node_modules',
    'run',
    'runs',
    'run-server',
    'logs',
    'crash-reports',
]);
const privateName = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|secrets(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore))$/iu;
/**
 * Hash source, resource and build inputs; unreadable files make the inventory incomplete and fail the operation.
 * @param cwd - Absolute project root.
 * @param signal - Caller cancellation signal.
 * @returns Protected path hashes and their stable inventory fingerprint.
 */
export async function projectInputs(cwd, signal) {
    const files = {};
    let total = 0;
    const visit = async (directory) => {
        const rows = await readdir(await projectPath(cwd, directory), { withFileTypes: true });
        for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
            signal?.throwIfAborted();
            if (excluded.has(row.name) || privateName.test(row.name))
                continue;
            const path = directory ? `${directory}/${row.name}` : row.name;
            if (path === '.dsh') {
                for (const owned of ['.dsh/dependencies.json', '.dsh/dependencies.gradle']) {
                    const file = await projectPath(cwd, owned, true);
                    const info = await lstat(file).catch((error) => {
                        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                            return undefined;
                        throw error;
                    });
                    if (info?.isFile())
                        files[owned] = await fileDigest(file);
                }
                continue;
            }
            if (row.isSymbolicLink())
                throw new Error(`项目输入包含符号链接，无法完整验收：${path}`);
            if (row.isDirectory())
                await visit(path);
            else if (row.isFile()) {
                const file = await projectPath(cwd, path);
                total += (await lstat(file)).size;
                if (Object.keys(files).length >= 20_000 || total > 2 * 1024 ** 3)
                    throw new Error('项目输入超过验收与恢复点容量限制。');
                files[path] = await fileDigest(file);
            }
            else
                throw new Error(`项目输入不是普通文件：${path}`);
        }
    };
    await visit('');
    return { files, fingerprint: hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))) };
}
//# sourceMappingURL=project-inputs.js.map