/** Transactional synchronization of only the JARs owned by a test instance. */
import { mkdir, readFile, writeFile, copyFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { matchesDependencyVersion as matches } from "./dependency-version.js";
import { projectPath, hash } from "./files.js";
import { fileDigest } from "./transfer.js";
import { inspectJarTree } from "./dependencies.js";
const digest = z.string().regex(/^[a-f\d]{64}$/u);
const filename = z.string().regex(/^[a-z][a-z\d_-]*-[a-f\d]{12}\.jar$/u);
const stateSchema = z.object({ format: z.literal(1), files: z.record(filename, digest) });
const journalSchema = z.object({
    before: stateSchema,
    after: stateSchema,
    changes: z.array(z.object({ name: filename, before: digest.nullable(), after: digest.nullable() })).max(101),
});
async function optionalRead(file) {
    return readFile(file).catch((error) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return undefined;
        throw error;
    });
}
/**
 * Recover an interrupted replacement only if each target still matches one side of its journal.
 * @param directory - Isolated side-specific instance directory.
 */
export async function recoverInstanceMods(directory) {
    const journal = await projectPath(directory, 'mods-transaction.json', true);
    const bytes = await optionalRead(journal);
    if (!bytes)
        return;
    const value = journalSchema.parse(JSON.parse(bytes.toString()));
    for (const change of value.changes) {
        const path = await projectPath(directory, `mods/${change.name}`, true);
        const content = await optionalRead(path);
        const current = content ? hash(content) : null;
        if (current !== change.before && current !== change.after)
            throw new Error(`实例文件被外部修改，无法自动回滚：${change.name}`);
    }
    for (const change of value.changes) {
        const target = await projectPath(directory, `mods/${change.name}`, true);
        if (change.before) {
            const backup = await projectPath(directory, `mod-staging/${change.before}`);
            if ((await fileDigest(backup)) !== change.before)
                throw new Error('实例事务备份损坏。');
            const temporary = await projectPath(directory, 'mod-staging/restore.tmp', true);
            await copyFile(backup, temporary);
            await rename(temporary, target);
        }
        else
            await unlink(target).catch((error) => {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                    throw error;
            });
    }
    await writeFile(await projectPath(directory, 'mods-state.json', true), JSON.stringify(value.before));
    await unlink(journal);
}
/**
 * Verify the complete selected dependency closure before replacing any managed JAR.
 * @param cwd - Absolute project root.
 * @param directory - Isolated side-specific instance directory.
 * @param artifact - Accepted publication and pinned loader identity.
 * @param dependencies - Committed dependency lock entries.
 * @param side - Requested local client or server.
 * @param selection - Required-only or currently enabled test dependencies.
 * @param java - Selected JVM executable or major required by this operation.
 */
export async function syncInstanceMods(cwd, directory, artifact, dependencies, side, selection, java) {
    await recoverInstanceMods(directory);
    const retained = new Set(dependencies
        .filter(row => !row.automatic &&
        (row.role === 'required' || (selection === 'selected' && (row.role === 'test' || row.enabled))))
        .map(row => row.id));
    const walk = (id, ancestors) => {
        if (ancestors.has(id))
            throw new Error('测试依赖包含循环。');
        const row = dependencies.find(dep => dep.id === id);
        if (!row)
            throw new Error(`缺少已锁定依赖：${id}`);
        for (const child of row.dependencies) {
            retained.add(child);
            walk(child, new Set([...ancestors, id]));
        }
    };
    for (const id of [...retained])
        walk(id, new Set());
    const artifacts = [
        { file: artifact.path, sha256: artifact.sha256 },
        ...dependencies.filter(dep => retained.has(dep.id)).map(dep => ({ file: dep.file, sha256: dep.sha256 })),
    ];
    const items = [];
    for (const row of artifacts) {
        const bytes = await readFile(await projectPath(cwd, row.file));
        if (hash(bytes) !== row.sha256)
            throw new Error(`测试文件校验失败：${row.file}`);
        const tree = inspectJarTree(bytes);
        const descriptor = tree[0];
        if (!descriptor)
            continue;
        if (descriptor.side && descriptor.side !== side)
            continue;
        const descriptors = tree.filter(row => !row.side || row.side === side);
        if (!descriptor.modId || !descriptor.version || descriptor.loader !== artifact.loader)
            throw new Error(`无法确认测试依赖的模组身份：${row.file}`);
        items.push({ ...row, bytes, descriptor, descriptors });
    }
    const identities = new Map([
        ['minecraft', artifact.minecraft],
        ['java', `${java}.0.0`],
        [artifact.loader === 'fabric' ? 'fabricloader' : 'neoforge', artifact.loaderVersion],
    ]);
    if (!items.some(row => row.sha256 === artifact.sha256))
        throw new Error('成品模组不支持所选运行侧。');
    const descriptors = items.flatMap(row => row.descriptors).filter(row => row.modId && row.version);
    for (const descriptor of descriptors) {
        const id = descriptor.modId;
        const version = descriptor.version;
        if (!id || !version)
            continue;
        if (identities.has(id))
            throw new Error(`测试实例存在重复 mod ID：${id}`);
        identities.set(id, version);
    }
    for (const descriptor of descriptors) {
        for (const incompatible of descriptor.incompatible ?? []) {
            if (descriptor.requirementSides?.[incompatible] && descriptor.requirementSides[incompatible] !== side)
                continue;
            const version = identities.get(incompatible);
            if (version && matches(version, descriptor.incompatibleRanges?.[incompatible] ?? ['*']))
                throw new Error(`${descriptor.modId} 声明与 ${incompatible} 不兼容。`);
        }
        for (const [id, ranges] of Object.entries(descriptor.requirements)) {
            if (descriptor.requirementSides?.[id] && descriptor.requirementSides[id] !== side)
                continue;
            const actual = identities.get(id);
            if (!actual || !matches(actual, ranges))
                throw new Error(`测试实例缺少兼容依赖：${id} ${ranges.join(' 或 ')}`);
        }
    }
    const statePath = await projectPath(directory, 'mods-state.json', true);
    const prior = await optionalRead(statePath);
    const before = prior ? stateSchema.parse(JSON.parse(prior.toString())) : { format: 1, files: {} };
    for (const [name, expected] of Object.entries(before.files)) {
        const content = await optionalRead(await projectPath(directory, `mods/${name}`, true));
        if (!content || hash(content) !== expected)
            throw new Error(`实例文件被外部修改或缺失：${name}`);
    }
    const after = {
        format: 1,
        files: Object.fromEntries(items.map(row => [`${row.descriptor.modId}-${row.sha256.slice(0, 12)}.jar`, row.sha256])),
    };
    const changes = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
        .filter(name => before.files[name] !== after.files[name])
        .map(name => ({ name, before: before.files[name] ?? null, after: after.files[name] ?? null }));
    await mkdir(await projectPath(directory, 'mods', true), { recursive: true });
    await mkdir(await projectPath(directory, 'mod-staging', true), { recursive: true });
    for (const change of changes) {
        const target = await projectPath(directory, `mods/${change.name}`, true);
        const content = await optionalRead(target);
        if ((content ? hash(content) : null) !== change.before)
            throw new Error(`实例文件被外部修改：${change.name}`);
        if (content && change.before)
            await writeFile(await projectPath(directory, `mod-staging/${change.before}`, true), content);
        if (change.after) {
            const source = items.find(row => row.sha256 === change.after);
            if (!source)
                throw new Error('实例事务缺少已校验文件。');
            await writeFile(await projectPath(directory, `mod-staging/${change.after}`, true), source.bytes);
        }
    }
    const journal = await projectPath(directory, 'mods-transaction.json', true);
    const journalTemporary = await projectPath(directory, 'mods-transaction.tmp', true);
    await writeFile(journalTemporary, JSON.stringify({ before, after, changes }));
    await rename(journalTemporary, journal);
    try {
        for (const change of changes) {
            const target = await projectPath(directory, `mods/${change.name}`, true);
            const content = await optionalRead(target);
            if ((content ? hash(content) : null) !== change.before)
                throw new Error(`提交期间实例文件被外部修改：${change.name}`);
            if (change.after) {
                const temporary = await projectPath(directory, 'mod-staging/commit.tmp', true);
                await copyFile(await projectPath(directory, `mod-staging/${change.after}`), temporary);
                await rename(temporary, target);
            }
            else
                await unlink(target);
        }
        const temporary = join(directory, 'mods-state.tmp');
        await writeFile(temporary, JSON.stringify(after));
        await rename(temporary, statePath);
        await unlink(journal);
    }
    catch (error) {
        await recoverInstanceMods(directory);
        throw error;
    }
}
//# sourceMappingURL=instance-mods.js.map