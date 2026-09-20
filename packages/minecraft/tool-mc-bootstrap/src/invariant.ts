/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-mc-bootstrap`.
 * @module @deepseek-ai/dsh-tool-mc-bootstrap/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-mc-bootstrap'

/** Cordis companion plugin name. */
export const name = 'tool-mc-bootstrap-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the host service keeps its operation state private and emits reconnectable snapshots. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
