/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-client-ui-mcmod-workbench`.
 * @module @deepseek-ai/dsh-client-ui-mcmod-workbench/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-mcmod-workbench'

/**
 * Cordis companion plugin name.
 */
export const name = 'client-ui-mcmod-workbench-invariant'
/**
 * Service required before the companion can reserve package ownership.
 */
export const inject = ['invariants']

/** No runtime invariant: the workbench renders host operations and owns only editor drafts and viewing state. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Host context providing the required capabilities.
 * @returns Register this package's invariant companion.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
