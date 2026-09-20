/** Export only a validated artifact whose complete source and dependency evidence is still current. */
import { mkdir, copyFile, writeFile, rename, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectInputs } from "./project-inputs.js";
import { fileDigest } from "./transfer.js";
import { projectPath } from "./files.js";
import { manifestSchema } from "./contracts.js";
/**
 * Publish a JAR, its SHA-256 and concise build/runtime evidence together in an owned export directory.
 * @param cwd - Absolute project root.
 * @param runs - Retained build and runtime records, newest first.
 * @returns Committed export directory and publication filename.
 */
export async function exportMod(cwd, runs) {
    const inputs = await projectInputs(cwd);
    const run = runs.find(row => row.artifact?.inputFingerprint === inputs.fingerprint);
    const artifact = run?.artifact;
    if (!artifact)
        throw new Error('没有对应当前源码的验收产物，请以成品模式构建。');
    const manifest = await readFile(await projectPath(cwd, '.dsh/dependencies.json', true), 'utf8').catch((error) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return undefined;
        throw error;
    });
    if (manifest)
        for (const dependency of manifestSchema.parse(JSON.parse(manifest)).dependencies) {
            if ((await fileDigest(await projectPath(cwd, dependency.file))) !== dependency.sha256)
                throw new Error(`依赖已变化，请重新验收：${dependency.name}`);
        }
    const file = await projectPath(cwd, artifact.path);
    if ((await fileDigest(file)) !== artifact.sha256)
        throw new Error('产物已变化，请重新构建验收。');
    const id = randomUUID();
    const destination = await projectPath(cwd, `.dsh/exports/${id}`, true);
    const staging = await projectPath(cwd, `.dsh/exports/${id}.tmp`, true);
    await mkdir(staging, { recursive: true });
    const name = basename(file);
    await copyFile(file, join(staging, name));
    if ((await fileDigest(join(staging, name))) !== artifact.sha256 ||
        (await projectInputs(cwd)).fingerprint !== inputs.fingerprint)
        throw new Error('导出期间项目或产物发生变化，请重新验收。');
    const runtime = runs
        .filter(row => row.artifact?.sha256 === artifact.sha256 && row.artifact.inputFingerprint === inputs.fingerprint)
        .map(row => ({ side: row.action, runId: row.id, log: row.logPath, evidence: row.evidence ?? null }));
    await writeFile(join(staging, `${name}.sha256`), `${artifact.sha256}  ${name}\n`);
    await writeFile(join(staging, `${name}.json`), JSON.stringify({ format: 1, artifact, build: 'passed', runtime, gameplay: 'unverified' }, null, 2) + '\n');
    await rename(staging, destination);
    return { path: destination, artifacts: [name] };
}
//# sourceMappingURL=export.js.map