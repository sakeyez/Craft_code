/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-minecraft-neoforge-headless-bundle`.
 * @module @deepseek-ai/dsh-minecraft-neoforge-headless-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-minecraft-neoforge-headless-bundle'

/** Cordis companion plugin name. */
export const name = 'minecraft-neoforge-headless-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package is a static patch-list carrier. The
// inserted rows are owned by their implementing packages.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
