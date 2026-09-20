/** Loader-mounted bootstrap reaches file generation through shared Java preparation. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-tool-mc-bootstrap'
import type { OperationSnapshot } from '@deepseek-ai/dsh-tool-mc-bootstrap'
import { fabricEntry } from '@deepseek-ai/dsh-tool-mc-bootstrap'
import { launchWebScaffold } from './scaffold.ts'

it('injects subprocess into the bootstrap Java preparation context', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(process.cwd(), 'packages/bundle/mcmod/cordis.patch.yml'),
  })
  const stops: Array<() => void> = []
  try {
    const entry = fabricEntry('1.21.1', '0.16.5', 'intermediary', '1.21.1+build.3', '0.102.0+1.21.1')
    const cache = join(scaffold.harnessHome, 'cache/minecraft-bootstrap')
    await mkdir(cache, { recursive: true })
    await writeFile(join(cache, 'catalog.json'), JSON.stringify({ format: 1, fetchedAt: new Date().toISOString(), entries: [entry] }))
    const bin = join(scaffold.workspaceCwd, 'fixture-jdk/bin')
    await mkdir(bin, { recursive: true })
    const executable = join(bin, process.platform === 'win32' ? 'java.exe' : 'java')
    await writeFile(join(bin, process.platform === 'win32' ? 'javac.exe' : 'javac'), '')
    const subprocess = scaffold.ctx.subprocess
    const spawn = subprocess.spawn.bind(subprocess)
    stops.push(vi.spyOn(subprocess, 'resolveExecutable').mockResolvedValue(executable).mockRestore)
    const probes = vi.spyOn(subprocess, 'spawn').mockImplementation(spec => spawn({
      ...spec, argv: [process.execPath, '-e', 'process.stderr.write(\'openjdk version "21.0.1"\\n\')'],
    }))
    stops.push(probes.mockRestore)
    const service = scaffold.ctx.minecraftBootstrap
    const stages: string[] = []
    stops.push(scaffold.ctx.on('minecraft-bootstrap/progress', (value) => {
      const snapshot = value as OperationSnapshot
      stages.push(snapshot.stage)
      // Stop before downloads; the process boundary above supplies only Java identity.
      if (snapshot.stage === 'generate') service.cancel(snapshot.operationId)
    }))
    const { operationId } = await service.start({
      entryId: entry.entryId, parentDirectory: scaffold.workspaceCwd, directoryName: 'java-injection',
      modName: 'Java Injection', modId: 'java_injection', packageName: 'example.java_injection',
    })
    await expect.poll(() => service.status(operationId)?.status, { timeout: 20_000 }).toMatch(/cancelled|failed/u)
    expect(service.status(operationId)).toMatchObject({ status: 'cancelled' })
    expect(stages).toContain('generate')
    expect(probes).toHaveBeenCalled()
    expect(service.status(operationId)?.logTail).not.toContain('without inject')
  } finally {
    for (const stop of stops.reverse()) stop()
    await scaffold.close()
  }
}, 60_000)
