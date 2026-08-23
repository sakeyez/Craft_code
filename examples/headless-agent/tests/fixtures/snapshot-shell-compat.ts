import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'snapshot-shell-compat'

/** Tool registry required by the Windows snapshot compatibility tool. */
export const inject = ['tools']

interface SnapshotShellArgs {
  command: string
  description: string
}

const CLI_ROUND_TRIP = 'printf CLI_TOOL_ROUND_TRIP'
const ALPHA_MARKER = "printf 'alpha\n'"

function outputFor(command: string): string {
  if (command === CLI_ROUND_TRIP) return 'CLI_TOOL_ROUND_TRIP'
  if (command === ALPHA_MARKER || command === "printf 'alpha\\n'") return 'alpha\n'
  throw new Error(`snapshot shell compatibility does not allow command ${JSON.stringify(command)}`)
}

/** Register the restricted `bash` fixture only on Windows, where the product profile uses PowerShell. */
export function apply(ctx: Context): void {
  if (process.platform !== 'win32') return
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Run one of the fixed shell commands used by this snapshot fixture.',
    parameters: {
      command: { type: 'string', required: true },
      description: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args: SnapshotShellArgs) => Promise.resolve(outputFor(args.command)),
  }))
}
