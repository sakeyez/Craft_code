/** Minecraft-only consumers of API evidence and automatic file checkpoints. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

export const name = 'mc-workbench-tools'
export const inject = ['tools', 'minecraftWorkbench']

/** Mount read-only API queries and require a complete checkpoint before each turn's first modifying tool. */
export function apply(ctx: Context): void {
  const turns = new WeakMap<object, { turn: number; checkpoint: Promise<unknown> }>()
  ctx.on('tools/execute', async (exec, next) => {
    const session = exec.agent?.session
    if (session && ['write', 'edit', 'bash', 'pwsh', 'str_replace_editor', 'run_mc_check'].includes(exec.name)) {
      const cwd = session.header.cwd
      if (!cwd) throw new Error('项目路径缺失，无法在修改前创建恢复点。')
      return ctx.minecraftWorkbench.checkpoints.mutate(cwd, async () => {
        exec.signal.throwIfAborted()
        const turn = [...session.events].reverse().find(event => event.type === 'turn/start')
        const number = turn?.type === 'turn/start' ? turn.data.turn : 0
        let state = turns.get(session)
        if (!state || state.turn !== number) {
          state = {
            turn: number,
            checkpoint: ctx.minecraftWorkbench.checkpoints.create(
              cwd,
              'automatic',
              `会话 ${session.id} / ${number}`,
              exec.signal,
            ),
          }
          turns.set(session, state)
        }
        try {
          await state.checkpoint
        } catch (error) {
          turns.delete(session)
          throw error
        }
        return next()
      })
    }
    return next()
  })
  ctx.tools.register(
    defineTool({
      name: 'query_mc_api',
      description:
        'Query a fully qualified Java class and its public method descriptors from the current project’s exact, hash-verified build classpath. Reports Minecraft version, mapping namespace, source and cache status. Build the project first. External mappings.dev evidence is optional and remains unverified; names are never converted across versions or mappings.',
      parameters: {
        symbol: {
          type: 'string',
          required: true,
          description: 'Fully qualified class name in the current project namespace.',
        },
        version: {
          type: 'string',
          description: 'Optional exact Minecraft version; a mismatch with the project is rejected.',
        },
        external: {
          type: 'boolean',
          description: 'Allow mappings.dev fallback when no class is found locally. Defaults to false.',
        },
      },
      isConcurrencySafe: () => true,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symbol: { type: 'string', required: true },
            version: { type: 'string', required: true },
            namespace: { type: 'string', required: true },
            verified: { type: 'boolean', required: true },
            source: { type: 'string', required: true },
            cached: { type: 'boolean', required: true },
            text: { type: 'string', required: true },
          },
        },
        render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
      },
      execute: async (args: { symbol: string; version?: string; external?: boolean }, exec) => {
        const cwd = exec.agent?.session.header.cwd
        if (!cwd) throw new Error('API 查询需要当前项目路径。')
        const result = await ctx.minecraftWorkbench.queryApi(cwd, args, exec.signal)
        return result
      },
    }),
  )
}
