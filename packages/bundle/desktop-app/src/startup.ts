/**
 * The desktop app's command-line provider: it parses the private desktop
 * `--port` flag and its `--help`
 * text, then provides the immutable values as {@link DESKTOP_STARTUP_SERVICE}.
 * Ordinary rows inject that service before reading it from lazy config.
 * @module @deepseek-ai/dsh-desktop-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'desktop-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
export const DESKTOP_STARTUP_SERVICE = 'desktopStartup'

/** What the desktop rows read from {@link DESKTOP_STARTUP_SERVICE}. */
export interface DesktopStartupValues {
  /** `--port`, absent when the invocation did not name one. */
  port?: number
}

/** The desktop flag family, as commander parsed it. */
interface DesktopOptions {
  port?: string
}

/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function desktopCommand(): Command {
  return new Command()
    .name('dsh --profile desktop')
    .description('Serve the private CraftCode desktop UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .addHelpText('after', `
Examples:
  dsh --profile desktop                      serve the private desktop UI
  dsh --profile desktop --port 8080          serve on another port
`)
}

/**
 * Parse and provide the desktop invocation as an ordinary Cordis service. A
 * non-numeric `--port` is a usage error, so on rejection (and on `--help`)
 * nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = desktopCommand()
  program.action(() => {
    const options = program.opts<DesktopOptions>()
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    ctx.provide(DESKTOP_STARTUP_SERVICE, {
      ...options.port !== undefined && { port: Number(options.port) },
    } satisfies DesktopStartupValues)
  })
  parseCmdline(ctx, program)
}
