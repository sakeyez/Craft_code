import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import type { SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { OutputCollector, spawnSubprocess } from '../src/spawn.ts'

const { failNextOpen, failNextWrite, shortNextWrite, failNextClose, failNextUnlink } = vi.hoisted(() => ({
  failNextOpen: { value: undefined as string | undefined },
  failNextWrite: { value: undefined as string | undefined },
  shortNextWrite: { value: undefined as number | undefined },
  failNextClose: { value: false },
  failNextUnlink: { value: false },
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    openSync(path: Parameters<typeof actual.openSync>[0], flags: string, mode?: number): number {
      if (failNextOpen.value !== undefined) {
        const code = failNextOpen.value
        failNextOpen.value = undefined
        throw Object.assign(new Error(`simulated ${code} on open`), { code })
      }
      return actual.openSync(path, flags, mode)
    },
    writeSync(fd: number, buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset): number {
      if (failNextWrite.value !== undefined) {
        const code = failNextWrite.value
        failNextWrite.value = undefined
        throw Object.assign(new Error(`simulated ${code} on write`), { code })
      }
      const requested = shortNextWrite.value ?? length
      shortNextWrite.value = undefined
      return actual.writeSync(fd, buffer, offset, Math.min(length, requested))
    },
    closeSync(fd: number): void {
      if (failNextClose.value) {
        failNextClose.value = false
        throw Object.assign(new Error('simulated EIO on close'), { code: 'EIO' })
      }
      actual.closeSync(fd)
    },
    unlinkSync(path: Parameters<typeof actual.unlinkSync>[0]): void {
      if (failNextUnlink.value) {
        failNextUnlink.value = false
        throw Object.assign(new Error('simulated EIO on unlink'), { code: 'EIO' })
      }
      actual.unlinkSync(path)
    },
  }
})

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-subprocess-output-spec-'))

function spec(script: string, {
  stdoutMaxBytes = 64_000,
  stderrMaxBytes = 64_000,
}: { stdoutMaxBytes?: number; stderrMaxBytes?: number } = {}): SubprocessSpawnSpec {
  return {
    argv: [process.execPath, '-e', script],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: stdoutMaxBytes, spill: { maxBytes: 64 * 1024 * 1024 } },
      stderr: { maxBytes: stderrMaxBytes, spill: { maxBytes: 64 * 1024 * 1024 } },
    },
    graceMs: 3_000,
  }
}

async function finish(running: SubprocessHandle) {
  const outcome = await running.done
  const final = (reader: SubprocessOutputReader | undefined) => {
    const read = reader!.readFrom(0)
    return { text: read.text, truncated: read.lossy, ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {} }
  }
  return { ...outcome, stdout: final(running.collected.stdout), stderr: final(running.collected.stderr) }
}

describe('output truncation and spill', () => {
  it('flushes an incomplete UTF-8 suffix after the real child exits', async () => {
    const result = await finish(spawnSubprocess(spec('process.stdout.write(Buffer.from([0xe4, 0xb8]))')))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toEqual({ text: '�', truncated: false })
  })

  it.each(['ENOENT', 'EACCES', 'ENOSPC'])('settles with a bounded tail when spill I/O fails with %s', async (code) => {
    if (code === 'EACCES') failNextOpen.value = code
    if (code === 'ENOSPC') failNextWrite.value = code
    const result = await finish(spawnSubprocess(
      spec('process.stdout.write("x".repeat(500))', { stdoutMaxBytes: 10 }),
      { spillDir: code === 'ENOENT' ? join(spillDir, 'missing-directory') : spillDir },
    ))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toEqual({ text: 'x'.repeat(10), truncated: true })
    expect(failNextOpen.value).toBeUndefined()
    expect(failNextWrite.value).toBeUndefined()
  })

  it('applies stdout and stderr caps independently', async () => {
    const result = await finish(spawnSubprocess(
      spec('process.stdout.write("x".repeat(500)); process.stderr.write("e".repeat(500))', {
        stdoutMaxBytes: 500,
        stderrMaxBytes: 100,
      }),
      { spillDir },
    ))
    expect(result.stdout.truncated).toBe(false)
    expect(result.stdout.text).toBe('x'.repeat(500))
    expect(result.stderr.truncated).toBe(true)
    expect(result.stderr.text.length).toBeLessThanOrEqual(100)
  })

  it('keeps the tail and spills the full stream to disk', async () => {
    // 200 numbered lines of ~10 bytes; cap at 500 bytes keeps a late tail.
    const result = await finish(spawnSubprocess(
      spec('for (let i = 1; i <= 200; i++) console.log("line-" + String(i).padStart(4, "0"))', { stdoutMaxBytes: 500, stderrMaxBytes: 500 }),
      { spillDir },
    ))
    expect(result.stdout.truncated).toBe(true)
    expect(result.stdout.text.length).toBeLessThanOrEqual(500)
    expect(result.stdout.text).toContain('line-0200')
    expect(result.stdout.text).not.toContain('line-0001')
    expect(result.stdout.spillPath).toBeDefined()
    const full = readFileSync(result.stdout.spillPath!, 'utf8')
    expect(full).toContain('line-0001')
    expect(full).toContain('line-0200')
  })

  it('does not truncate output exactly at the cap', async () => {
    const result = await finish(spawnSubprocess(
      spec('process.stdout.write("x".repeat(500))', { stdoutMaxBytes: 500, stderrMaxBytes: 500 }),
      { spillDir },
    ))
    expect(result.stdout.truncated).toBe(false)
    expect(result.stdout.text.length).toBe(500)
    expect(result.stdout.spillPath).toBeUndefined()
  })

  it('settles with the tail and no spill path when final spill close fails', async () => {
    failNextClose.value = true
    const result = await finish(spawnSubprocess(
      spec('for (let i = 1; i <= 200; i++) console.log("line-" + String(i).padStart(4, "0"))', { stdoutMaxBytes: 500, stderrMaxBytes: 500 }),
      { spillDir },
    ))
    expect(failNextClose.value).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.truncated).toBe(true)
    expect(result.stdout.text).toContain('line-0200')
    expect(result.stdout.spillPath).toBeUndefined()
  })
})

describe('OutputCollector', () => {
  it('keeps the tail of a single oversized chunk', () => {
    const collector = new OutputCollector(10, 100, 'test', spillDir)
    collector.push(Buffer.from('0123456789abcdef'))
    const out = collector.finalize()
    expect(out.text).toBe('6789abcdef')
    expect(out.truncated).toBe(true)
    expect(readFileSync(out.spillPath!, 'utf8')).toBe('0123456789abcdef')
  })

  it('retains a byte-exact tail across uneven chunk boundaries', () => {
    // A diagnostic tail must be exactly the LAST maxBytes regardless of
    // chunking; dropping only whole chunks would under-retain.
    const collector = new OutputCollector(10, undefined, 'exact-tail', spillDir)
    collector.push(Buffer.from('aaaa'))
    collector.push(Buffer.from('bbbbbb'))
    collector.push(Buffer.from('cc'))
    const out = collector.finalize()
    expect(out.text).toBe('aabbbbbbcc')
    expect(Buffer.byteLength(out.text)).toBe(10)
    expect(out.truncated).toBe(true)
  })

  it('readFrom returns increments and flags lossy reads', () => {
    const collector = new OutputCollector(10, 100, 'test', spillDir)
    collector.push(Buffer.from('aaaaa'))
    const first = collector.readFrom(0)
    expect(first.text).toBe('aaaaa')
    expect(first.lossy).toBe(false)
    expect(first.nextOffset).toBe(5)

    collector.push(Buffer.from('bbbbb'))
    const second = collector.readFrom(first.nextOffset)
    expect(second.text).toBe('bbbbb')
    expect(second.lossy).toBe(false)

    // Push enough to slide the window past the last offset.
    collector.push(Buffer.from('c'.repeat(20)))
    const third = collector.readFrom(second.nextOffset)
    expect(third.lossy).toBe(true)
    expect(third.text).toBe('c'.repeat(10))
    expect(third.spillPath).toBeDefined()
  })

  it.each([
    ['¢', 1],
    ['中', 1],
    ['中', 2],
    ['🙂', 1],
    ['🙂', 2],
    ['🙂', 3],
  ] as const)('preserves %s split after byte %i for independent readers', (character, split) => {
    const collector = new OutputCollector(100, undefined, 'utf8', spillDir)
    const encoded = Buffer.from(character)
    collector.push(Buffer.concat([Buffer.from('a'), encoded.subarray(0, split)]))
    const first = collector.readFrom(0)
    expect(first).toEqual({ text: 'a', nextOffset: 1, lossy: false })
    expect(collector.readFrom(first.nextOffset)).toEqual({ text: '', nextOffset: 1, lossy: false })

    collector.push(Buffer.concat([encoded.subarray(split), Buffer.from('b')]))
    const nextOffset = encoded.length + 2
    expect(collector.readFrom(first.nextOffset)).toEqual({ text: `${character}b`, nextOffset, lossy: false })
    expect(collector.readFrom(0)).toEqual({ text: `a${character}b`, nextOffset, lossy: false })
    expect(collector.readFrom(nextOffset)).toEqual({ text: '', nextOffset, lossy: false })
  })

  it('keeps incomplete trailing characters pending when the retained window starts inside a character', () => {
    const collector = new OutputCollector(5, undefined, 'utf8-tail', spillDir)
    const encoded = Buffer.from('🙂')
    collector.push(Buffer.from('a中b'))
    collector.push(encoded.subarray(0, 3))
    const first = collector.readFrom(0)
    expect(first).toEqual({ text: 'b', nextOffset: 5, lossy: true })
    collector.push(encoded.subarray(3))
    expect(collector.readFrom(first.nextOffset)).toEqual({ text: '🙂', nextOffset: 9, lossy: false })
    expect(collector.finalize()).toEqual({ text: 'b🙂', truncated: true })
  })

  it('releases an incomplete UTF-8 suffix when sealed without a spill file', () => {
    const collector = new OutputCollector(5, undefined, 'utf8-end', spillDir)
    collector.push(Buffer.from([0xe4, 0xb8]))
    expect(collector.readFrom(0)).toEqual({ text: '', nextOffset: 0, lossy: false })
    collector.seal()
    expect(collector.readFrom(0)).toEqual({ text: '�', nextOffset: 2, lossy: false })
    expect(collector.readFrom(2)).toEqual({ text: '', nextOffset: 2, lossy: false })
  })

  it('omits a truncated leading character consistently from final and incremental reads', () => {
    const collector = new OutputCollector(3, undefined, 'utf8-head', spillDir)
    collector.push(Buffer.from('中ab'))
    expect(collector.readFrom(0)).toEqual({ text: 'ab', nextOffset: 5, lossy: true })
    expect(collector.finalize()).toEqual({ text: 'ab', truncated: true })
  })

  it('reports the gap when the tail holds only continuation bytes', () => {
    const collector = new OutputCollector(1, undefined, 'utf8-tiny', spillDir)
    collector.push(Buffer.from('中'))
    expect(collector.readFrom(0)).toEqual({ text: '', nextOffset: 3, lossy: true })
    expect(collector.finalize()).toEqual({ text: '', truncated: true })
  })

  it.each([1, 2])('keeps later continuation bytes inside the reported gap with a %i-byte tail', (maxBytes) => {
    const collector = new OutputCollector(maxBytes, undefined, 'utf8-fragment', spillDir)
    const encoded = Buffer.from('🙂')
    collector.push(encoded.subarray(0, 3))
    const first = collector.readFrom(0)
    expect(first).toEqual({ text: '', nextOffset: 3, lossy: true })

    collector.push(encoded.subarray(3))
    const second = collector.readFrom(first.nextOffset)
    expect(second).toEqual({ text: '', nextOffset: 4, lossy: true })
    expect(collector.readFrom(second.nextOffset)).toEqual({ text: '', nextOffset: 4, lossy: false })
    expect(collector.finalize()).toEqual({ text: first.text + second.text, truncated: true })
  })

  it.each([
    [0x80, 0x81],
    [0xc0, 0x80],
    [0xe0, 0x80],
    [0xed, 0xa0],
    [0xf0, 0x80],
    [0xf4, 0x90],
  ])('consumes malformed UTF-8 bytes %j without waiting for more output', (...bytes) => {
    const collector = new OutputCollector(10, undefined, 'utf8-invalid', spillDir)
    const buffer = Buffer.from(bytes)
    collector.push(buffer)
    expect(collector.readFrom(0)).toEqual({ text: buffer.toString('utf8'), nextOffset: buffer.length, lossy: false })
  })

  it('discards an incomplete spill after a write failure and keeps collecting in memory', () => {
    const collector = new OutputCollector(4, 100, 'writefail', spillDir)
    collector.push(Buffer.from('aaaa'))
    collector.push(Buffer.from('bbbb'))
    const spillPath = collector.readFrom(0).spillPath!
    failNextWrite.value = 'ENOSPC'
    expect(() => { collector.push(Buffer.from('cccc')) }).not.toThrow()
    expect(() => readFileSync(spillPath)).toThrow()
    collector.push(Buffer.from('dddd'))
    expect(collector.finalize()).toEqual({ text: 'dddd', truncated: true })
  })

  it('completes a partial spill write before advertising the complete stream', () => {
    const collector = new OutputCollector(4, 100, 'shortwrite', spillDir)
    collector.push(Buffer.from('aaaa'))
    shortNextWrite.value = 2
    collector.push(Buffer.from('bbbb'))
    const result = collector.finalize()
    expect(readFileSync(result.spillPath!, 'utf8')).toBe('aaaabbbb')
  })

  it('disables spilling when a write makes no progress', () => {
    const collector = new OutputCollector(4, 100, 'zerowrite', spillDir)
    shortNextWrite.value = 0
    expect(() => { collector.push(Buffer.from('aaaabbbb')) }).not.toThrow()
    expect(collector.finalize()).toEqual({ text: 'bbbb', truncated: true })
  })

  it('contains close failures and drops the spill path', () => {
    const collector = new OutputCollector(4, 100, 'closefail', spillDir)
    collector.push(Buffer.from('aaaa'))
    collector.push(Buffer.from('bbbb'))
    expect(collector.readFrom(0).spillPath).toBeDefined()

    failNextClose.value = true
    let out: ReturnType<typeof collector.finalize>
    expect(() => { out = collector.finalize() }).not.toThrow()

    expect(failNextClose.value).toBe(false)
    expect(out!.text).toBe('bbbb')
    expect(out!.truncated).toBe(true)
    expect(out!.spillPath).toBeUndefined()
  })

  it('discards a spill that exceeds its configured cap', () => {
    const collector = new OutputCollector(4, 8, 'bounded', spillDir)
    collector.push(Buffer.from('aaaa'))
    collector.push(Buffer.from('bbbb'))
    const spillPath = collector.readFrom(0).spillPath!
    expect(readFileSync(spillPath, 'utf8')).toBe('aaaabbbb')

    collector.push(Buffer.from('c'))
    collector.push(Buffer.from('dddd'))
    const out = collector.finalize()
    expect(out.text).toBe('dddd')
    expect(out.truncated).toBe(true)
    expect(out.spillPath).toBeUndefined()
    expect(() => readFileSync(spillPath)).toThrow()
  })

  it('does not create a spill when the first overflowing chunk exceeds the cap', () => {
    const collector = new OutputCollector(4, 4, 'no-spill', spillDir)
    collector.push(Buffer.from('abcdefgh'))
    const out = collector.finalize()
    expect(out.text).toBe('efgh')
    expect(out.truncated).toBe(true)
    expect(out.spillPath).toBeUndefined()
  })

  it('contains cleanup failures while disabling an oversize spill', () => {
    const collector = new OutputCollector(4, 8, 'cleanup-fail', spillDir)
    collector.push(Buffer.from('aaaa'))
    collector.push(Buffer.from('bbbb'))
    const spillPath = collector.readFrom(0).spillPath!

    failNextClose.value = true
    failNextUnlink.value = true
    expect(() => { collector.push(Buffer.from('c')) }).not.toThrow()
    expect(failNextClose.value).toBe(false)
    expect(failNextUnlink.value).toBe(false)
    expect(collector.finalize().spillPath).toBeUndefined()
    unlinkSync(spillPath)
  })
})

describe('spill failure host containment', () => {
  it('keeps an independent Node host alive when its spill directory cannot be written', async () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const launch = resolveExampleLaunch({
      srcBin: fileURLToPath(new URL('./fixtures/spill-failure-host.ts', import.meta.url)),
      mode: 'src',
      tsconfigPath: join(repoRoot, 'tsconfig.json'),
      configArgs: [join(spillDir, 'missing-spill-directory')],
    })
    const result = await execa(launch.command, launch.args, {
      cwd: repoRoot,
      env: launch.env,
      stdin: 'ignore',
      reject: false,
      timeout: 10_000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      first: { exitCode: 0, text: 'x'.repeat(10), lossy: true, nextOffset: 500 },
      second: { exitCode: 0, text: 'host-alive', lossy: false, nextOffset: 10 },
    })
  })
})
