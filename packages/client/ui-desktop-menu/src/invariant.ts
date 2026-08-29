/** Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-desktop-menu`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-desktop-menu'

/** Cordis companion plugin name. */
export const name = 'client-ui-desktop-menu-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The slot registration and Electron boundary are covered by package tests. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
