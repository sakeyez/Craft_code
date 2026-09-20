import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { beforeEach, afterEach, expect, it } from 'vitest'
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project'
import { acceptArtifact } from '../src/artifact.ts'
import type { ArtifactEvidence, BuildFacts } from '../src/artifact.ts'
import { projectInputs } from '../src/project-inputs.ts'
import { syncInstanceMods, recoverInstanceMods } from '../src/instance-mods.ts'
import { inspectJarTree } from '../src/dependencies.ts'
import { hash } from '../src/files.ts'
import { exportMod } from '../src/export.ts'
import { workbenchIdSchema } from '../src/contracts.ts'
import { randomUUID } from 'node:crypto'
import type { RunSnapshot } from '../src/types.ts'

let root: string

it('checks dependencies declared by nested mods and detects edited managed instance files', async () => {
  const nested = zipSync({
    'fabric.mod.json': strToU8(JSON.stringify({ id: 'nested', version: '1.0.0', depends: { missing: '*' } })),
  })
  const bytes = zipSync({
    'fabric.mod.json': strToU8(JSON.stringify({ id: 'example', version: '1.0.0', jars: [{ file: 'nested.jar' }] })),
    'nested.jar': nested,
  })
  expect(inspectJarTree(bytes).map(row => row.modId)).toEqual(['example', 'nested'])
  await writeFile(join(root, 'build/libs/example.jar'), bytes)
  const evidence = await acceptArtifact(root, project, facts, (await projectInputs(root)).fingerprint)
  const directory = join(root, '.dsh/instances/test/client')
  await mkdir(directory, { recursive: true })
  await expect(syncInstanceMods(root, directory, evidence, [], 'client', 'required', 21)).rejects.toThrow('missing')
  const plain = await artifact()
  await syncInstanceMods(root, directory, plain, [], 'client', 'required', 21)
  await writeFile(join(directory, 'mods', `example-${plain.sha256.slice(0, 12)}.jar`), 'external')
  await expect(syncInstanceMods(root, directory, plain, [], 'client', 'required', 21)).rejects.toThrow('外部修改')
})
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-artifacts-'))
  await mkdir(join(root, 'build/libs'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const project = {
  loader: 'fabric',
  minecraftVersion: { status: 'determined', classification: 'exact', value: '1.21.1' },
  modIdCandidates: [{ id: 'example', confidence: 'high' }],
} as DetectionResult
const facts: BuildFacts = {
  artifacts: [{ task: 'remapJar', path: 'build/libs/example.jar', classifier: '' }],
  modules: [{ group: 'net.fabricmc', name: 'fabric-loader', version: '0.16.9' }],
  classpath: [],
}
async function artifact(depends: Record<string, string> = {}): Promise<ArtifactEvidence> {
  const bytes = zipSync({
    'fabric.mod.json': strToU8(JSON.stringify({ schemaVersion: 1, id: 'example', version: '1.0.0', depends })),
  })
  await writeFile(join(root, 'build/libs/example.jar'), bytes)
  return acceptArtifact(root, project, facts, (await projectInputs(root)).fingerprint)
}
it('exports current acceptance evidence and invalidates it after source or artifact changes', async () => {
  const evidence = await artifact()
  const run: RunSnapshot = { id: workbenchIdSchema.parse(randomUUID()), cwd: root, action: 'client', phase: 'cancelled',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), message: '', logPath: 'output.log',
    artifact: evidence, evidence: { gameplay: 'unverified', exitReason: 'cancelled' } }
  const exported = await exportMod(root, [run])
  const report: unknown = JSON.parse(await readFile(join(exported.path, 'example.jar.json'), 'utf8'))
  expect(report).toMatchObject({ build: 'passed', gameplay: 'unverified', runtime: [{ evidence: { gameplay: 'unverified' } }] })
  expect(await readFile(join(exported.path, 'example.jar.sha256'), 'utf8')).toContain(evidence.sha256)
  await writeFile(join(root, evidence.path), 'changed artifact')
  await expect(exportMod(root, [run])).rejects.toThrow('产物已变化')
  await writeFile(join(root, 'build.gradle'), 'changed source')
  await expect(exportMod(root, [run])).rejects.toThrow('当前源码')
})
it('selects the remapped publication and rejects ambiguous output or changed inputs', async () => {
  await artifact()
  const fingerprint = (await projectInputs(root)).fingerprint
  await expect(acceptArtifact(root, project, { ...facts, resources: ['assets/example/textures/missing.png'] }, fingerprint))
    .rejects.toThrow('缺少 Gradle 输出资源')
  await expect(
    acceptArtifact(root, project, { ...facts, artifacts: [...facts.artifacts, ...facts.artifacts] }, fingerprint),
  ).rejects.toThrow('不唯一')
  await writeFile(join(root, 'build.gradle'), 'changed')
  await expect(acceptArtifact(root, project, facts, fingerprint)).rejects.toThrow('发生变化')
})
it('rejects missing nested JARs and entrypoint bytecode', async () => {
  const metadata = { schemaVersion: 1, id: 'example', version: '1.0.0', jars: [{ file: 'missing.jar' }] }
  await writeFile(
    join(root, 'build/libs/example.jar'),
    zipSync({ 'fabric.mod.json': strToU8(JSON.stringify(metadata)) }),
  )
  await expect(acceptArtifact(root, project, facts, (await projectInputs(root)).fingerprint)).rejects.toThrow(
    '嵌套依赖',
  )
})
it('validates the complete dependency set before touching mods and preserves unmanaged files', async () => {
  const directory = join(root, '.dsh/instances/test/server')
  await mkdir(join(directory, 'mods'), { recursive: true })
  await writeFile(join(directory, 'mods/user.jar'), 'user')
  await expect(
    syncInstanceMods(root, directory, await artifact({ missing: '*' }), [], 'server', 'required', 21),
  ).rejects.toThrow('缺少兼容依赖')
  const accepted = await artifact({ java: '>=21', minecraft: '1.21.1', fabricloader: '>=0.16.9' })
  await syncInstanceMods(root, directory, accepted, [], 'server', 'required', 21)
  expect(await readFile(join(directory, 'mods/user.jar'), 'utf8')).toBe('user')
  const state = JSON.parse(await readFile(join(directory, 'mods-state.json'), 'utf8')) as {
    files: Record<string, string>
  }
  expect(Object.values(state.files)).toEqual([accepted.sha256])
})
it('recovers a cross-file interruption and refuses an external edit conflict', async () => {
  const directory = join(root, 'instance')
  await mkdir(join(directory, 'mods'), { recursive: true })
  await mkdir(join(directory, 'mod-staging'))
  const before = hash('before')
  const after = hash('after')
  const name = `example-${before.slice(0, 12)}.jar`
  await writeFile(join(directory, 'mod-staging', before), 'before')
  await writeFile(join(directory, 'mods', name), 'after')
  const journal = {
    before: { format: 1, files: { [name]: before } },
    after: { format: 1, files: { [name]: after } },
    changes: [{ name, before, after }],
  }
  await writeFile(join(directory, 'mods-transaction.json'), JSON.stringify(journal))
  await recoverInstanceMods(directory)
  expect(await readFile(join(directory, 'mods', name), 'utf8')).toBe('before')
  await writeFile(join(directory, 'mods-transaction.json'), JSON.stringify(journal))
  await writeFile(join(directory, 'mods', name), 'external')
  await expect(recoverInstanceMods(directory)).rejects.toThrow('外部修改')
})
