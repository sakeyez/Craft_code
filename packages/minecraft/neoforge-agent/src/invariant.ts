/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-minecraft-neoforge-agent`.
 * @module @deepseek-ai/dsh-minecraft-neoforge-agent/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-minecraft-neoforge-agent'

/** Cordis companion plugin name. */
export const name = 'minecraft-neoforge-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no event stream or mutable runtime
 * data. It registers fixed prompt sections; the prompt registry owns duplicate
 * detection, scoped shadowing, assembly, and disposal.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
