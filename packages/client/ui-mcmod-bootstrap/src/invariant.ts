/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-client-ui-mcmod-bootstrap`.
 * @module @deepseek-ai/dsh-client-ui-mcmod-bootstrap/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-mcmod-bootstrap'

/** Cordis companion plugin name. */
export const name = 'client-ui-mcmod-bootstrap-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the wizard owns only ephemeral browser state and a slot registration. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
