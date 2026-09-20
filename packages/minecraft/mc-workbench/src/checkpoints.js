/** Content-addressed project checkpoints and revision-checked recoverable restore transactions. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename, unlink, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { projectInputs } from "./project-inputs.js";
import { projectPath, hash } from "./files.js";
import { fileDigest } from "./transfer.js";
const digest = z.string().regex(/^[a-f\d]{64}$/u);
const manifest = z.object({
    format: z.literal(1),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    kind: z.enum(['automatic', 'manual', 'transaction', 'before-restore']),
    label: z.string().max(256),
    fingerprint: digest,
    files: z.record(z.string(), digest),
});
const change = z.object({ path: z.string(), before: digest.nullable(), after: digest.nullable() });
const journalSchema = z.object({ id: z.uuid(), changes: z.array(change).max(20000) });
const base = '.dsh/checkpoints';
async function optional(file) {
    return readFile(file).catch((error) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return undefined;
        throw error;
    });
}
function protectedPath(path) {
    if (path
        .split(/[\\/]/u)
        .some(part => ['.git', '.gradle', 'build', 'node_modules', 'run', 'runs', 'run-server'].includes(part)) ||
        /(?:^|[\\/])(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|secrets(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore))$/iu.test(path) ||
        (path.startsWith('.dsh/') && !['.dsh/dependencies.json', '.dsh/dependencies.gradle'].includes(path)))
        throw new Error('恢复点包含受保护范围以外的文件。');
}
/** Own checkpoint creation and restoration without changing Git state. */
export class MinecraftCheckpoints {
    static active = new Map();
    static edits = new Map();
    /**
     * Serialize protected project edits against restoration.
     * @param cwd - Absolute project root.
     * @param work - Protected mutation including its preceding checkpoint.
     * @returns The mutation result after earlier edits settle.
     */
    async mutate(cwd, work) {
        const prior = MinecraftCheckpoints.edits.get(cwd) ?? Promise.resolve();
        const result = prior.catch(() => { }).then(work);
        MinecraftCheckpoints.edits.set(cwd, result);
        try {
            return await result;
        }
        finally {
            if (MinecraftCheckpoints.edits.get(cwd) === result)
                MinecraftCheckpoints.edits.delete(cwd);
        }
    }
    async exclusive(cwd, work) {
        const prior = MinecraftCheckpoints.active.get(cwd) ?? Promise.resolve();
        const result = prior.catch(() => { }).then(work);
        MinecraftCheckpoints.active.set(cwd, result);
        try {
            return await result;
        }
        finally {
            if (MinecraftCheckpoints.active.get(cwd) === result)
                MinecraftCheckpoints.active.delete(cwd);
        }
    }
    /**
     * List only complete checkpoint manifests; manual checkpoints are not pruned.
     * @param cwd - Absolute project root.
     * @returns Complete retained checkpoint records, newest first.
     */
    async list(cwd) {
        const root = await projectPath(cwd, `${base}/records`, true);
        const names = await readdir(root).catch((error) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return [];
            throw error;
        });
        const rows = [];
        for (const name of names.filter(name => /^[a-f\d-]{36}\.json$/u.test(name))) {
            const row = manifest.parse(JSON.parse((await readFile(await projectPath(cwd, `${base}/records/${name}`))).toString()));
            if (`${row.id}.json` !== name)
                throw new Error('恢复点标识不一致。');
            rows.push(row);
        }
        return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    /**
     * Create a complete checkpoint before allowing a protected mutation.
     * @param cwd - Absolute project root.
     * @param kind - Checkpoint retention and creation reason.
     * @param label - User-visible checkpoint label.
     * @param signal - Caller cancellation signal.
     * @returns Published complete checkpoint manifest.
     */
    create(cwd, kind, label, signal) {
        return this.exclusive(cwd, async () => {
            await this.recover(cwd);
            return this.capture(cwd, kind, label, signal);
        });
    }
    async capture(cwd, kind, label, signal) {
        const inputs = await projectInputs(cwd, signal);
        await mkdir(await projectPath(cwd, `${base}/objects`, true), { recursive: true });
        await mkdir(await projectPath(cwd, `${base}/records`, true), { recursive: true });
        for (const [path, sha] of Object.entries(inputs.files)) {
            signal?.throwIfAborted();
            protectedPath(path);
            const target = await projectPath(cwd, `${base}/objects/${sha}`, true);
            if ((await fileDigest(target).catch(() => '')) === sha)
                continue;
            const temporary = target + '.' + randomUUID() + '.tmp';
            try {
                await copyFile(await projectPath(cwd, path), temporary);
                if ((await fileDigest(temporary)) !== sha)
                    throw new Error(`备份期间文件发生变化：${path}`);
                await rename(temporary, target);
            }
            finally {
                await unlink(temporary).catch(() => { });
            }
        }
        if ((await projectInputs(cwd, signal)).fingerprint !== inputs.fingerprint)
            throw new Error('备份期间项目发生变化，写操作已阻止。');
        const record = {
            format: 1,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            kind,
            label: label.slice(0, 256),
            ...inputs,
        };
        const target = await projectPath(cwd, `${base}/records/${record.id}.json`, true);
        await writeFile(target + '.tmp', JSON.stringify(record));
        await rename(target + '.tmp', target);
        const rows = await this.list(cwd);
        for (const row of rows.filter(row => row.kind === 'automatic').slice(20))
            await unlink(await projectPath(cwd, `${base}/records/${row.id}.json`));
        return record;
    }
    /**
     * Compare protected paths before any restore; additions are included in the preview.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     * @returns File differences bound to the current project fingerprint.
     */
    async preview(cwd, id) {
        return this.exclusive(cwd, async () => {
            await this.recover(cwd);
            const record = (await this.list(cwd)).find(row => row.id === id);
            if (!record)
                throw new Error('恢复点不存在。');
            const current = await projectInputs(cwd);
            const changes = [...new Set([...Object.keys(current.files), ...Object.keys(record.files)])]
                .sort()
                .filter(path => current.files[path] !== record.files[path])
                .map(path => ({ path, before: current.files[path] ?? null, after: record.files[path] ?? null }));
            let remaining = 256 * 1024;
            const previews = [];
            for (const row of changes) {
                protectedPath(row.path);
                const before = row.before ? await readFile(await projectPath(cwd, row.path)) : Buffer.alloc(0);
                const after = row.after
                    ? await readFile(await projectPath(cwd, `${base}/objects/${row.after}`))
                    : Buffer.alloc(0);
                if (row.after && hash(after) !== row.after)
                    throw new Error('恢复点内容校验失败。');
                const size = before.length + after.length;
                if (size <= Math.min(65536, remaining) &&
                    !before.includes(0) &&
                    !after.includes(0) &&
                    Buffer.from(before.toString()).equals(before) &&
                    Buffer.from(after.toString()).equals(after)) {
                    previews.push({ ...row, beforeText: before.toString(), afterText: after.toString() });
                    remaining -= size;
                }
                else
                    previews.push(row);
            }
            return { id, fingerprint: current.fingerprint, changes: previews };
        });
    }
    /**
     * Save the current state and atomically replace each file under a recoverable journal.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     * @param fingerprint - Expected hash of the protected project input inventory.
     */
    restore(cwd, id, fingerprint) {
        return this.mutate(cwd, () => this.exclusive(cwd, async () => {
            await this.recover(cwd);
            const record = (await this.list(cwd)).find(row => row.id === id);
            if (!record)
                throw new Error('恢复点不存在。');
            const current = await projectInputs(cwd);
            if (current.fingerprint !== fingerprint)
                throw new Error('项目在预览后已变化，请重新查看恢复差异。');
            await this.capture(cwd, 'before-restore', `恢复前 ${id}`);
            const changes = [...new Set([...Object.keys(current.files), ...Object.keys(record.files)])]
                .filter(path => current.files[path] !== record.files[path])
                .map(path => ({ path, before: current.files[path] ?? null, after: record.files[path] ?? null }));
            for (const row of changes) {
                protectedPath(row.path);
                if (row.after && (await fileDigest(await projectPath(cwd, `${base}/objects/${row.after}`))) !== row.after)
                    throw new Error('恢复点内容损坏。');
            }
            const journal = await projectPath(cwd, '.dsh/recovery-transaction.json', true);
            await writeFile(journal + '.tmp', JSON.stringify({ id, changes }));
            await rename(journal + '.tmp', journal);
            try {
                for (const row of changes) {
                    const target = await projectPath(cwd, row.path, true);
                    const bytes = await optional(target);
                    if ((bytes ? hash(bytes) : null) !== row.before)
                        throw new Error(`恢复期间文件发生变化：${row.path}`);
                    await this.replace(cwd, row.path, row.after);
                }
                await unlink(journal);
            }
            catch (error) {
                await this.recover(cwd);
                throw error;
            }
        }));
    }
    async replace(cwd, path, sha) {
        protectedPath(path);
        const target = await projectPath(cwd, path, true);
        if (!sha) {
            await unlink(target).catch((error) => {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                    throw error;
            });
            return;
        }
        const object = await projectPath(cwd, `${base}/objects/${sha}`);
        if ((await fileDigest(object)) !== sha)
            throw new Error('恢复点内容校验失败。');
        await mkdir(dirname(target), { recursive: true });
        const temporary = await projectPath(cwd, `${base}/restore.tmp`, true);
        await copyFile(object, temporary);
        await rename(temporary, target);
    }
    async recover(cwd) {
        const file = await projectPath(cwd, '.dsh/recovery-transaction.json', true);
        const content = await optional(file);
        if (!content)
            return;
        const journal = journalSchema.parse(JSON.parse(content.toString()));
        for (const row of journal.changes) {
            protectedPath(row.path);
            const bytes = await optional(await projectPath(cwd, row.path, true));
            const current = bytes ? hash(bytes) : null;
            if (current !== row.before && current !== row.after)
                throw new Error(`恢复事务遇到外部修改：${row.path}`);
        }
        for (const row of journal.changes)
            await this.replace(cwd, row.path, row.before);
        await unlink(file);
    }
    /**
     * Remove an explicitly selected checkpoint; shared content remains available to other records.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     */
    async remove(cwd, id) {
        await this.exclusive(cwd, async () => {
            z.uuid().parse(id);
            await unlink(await projectPath(cwd, `${base}/records/${id}.json`));
        });
    }
}
//# sourceMappingURL=checkpoints.js.map