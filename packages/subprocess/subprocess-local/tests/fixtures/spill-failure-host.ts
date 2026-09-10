import { spawnSubprocess } from '../../src/spawn.ts'

const [requestedSpillDir] = process.argv.slice(2)
if (requestedSpillDir === undefined) throw new Error('usage: spill-failure-host.ts <spill-directory>')
const spillDir = requestedSpillDir

async function capture(text: string) {
  const child = spawnSubprocess({
    argv: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(text)})`],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 10, spill: { maxBytes: 1_000 } },
      stderr: { maxBytes: 10 },
    },
    graceMs: 1_000,
  }, { spillDir })
  const { exitCode } = await child.done
  return { exitCode, ...child.collected.stdout?.readFrom(0) }
}

const first = await capture('x'.repeat(500))
const second = await capture('host-alive')
process.stdout.write(JSON.stringify({ first, second }))
