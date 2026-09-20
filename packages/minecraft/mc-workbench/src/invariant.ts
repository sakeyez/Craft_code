/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mc-workbench`.
 * @module @deepseek-ai/dsh-mc-workbench/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mc-workbench'

/**
 * Cordis companion plugin name.
 */
export const name = 'mc-workbench-invariant'
/**
 * Service required before the companion can reserve package ownership.
 */
export const inject = ['invariants']

/** No runtime invariant: the workbench owns private operations and validates snapshots at its RPC boundary. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Host context providing the required capabilities.
 * @returns Register this package's invariant companion.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
