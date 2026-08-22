/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-mc-project`.
 * @module @deepseek-ai/dsh-tool-mc-project/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-mc-project'

/** Cordis companion plugin name. */
export const name = 'tool-mc-project-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no durable events or mutable runtime
 * data. It registers one read-only tool; the tool registry owns schema
 * validation, scoped registration, execution, presentation, and disposal.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
