/** Pure Gradle task parsing shared by model tools and desktop launch controls. */

/** Minecraft runtime side used to select conventional Gradle launch tasks. */
export type RuntimeMode = 'client' | 'server'

/**
 * Parse task names from complete plain `gradle tasks --all` output.
 * @param text - Complete, non-truncated Gradle task output.
 * @returns Unique task names in stable lexical order.
 */
export function parseGradleTaskNames(text: string): string[] {
  const tasks: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*:?(?<task>[A-Za-z][A-Za-z0-9:_-]*)\s*(?:-\s+.*)?$/u.exec(line)
    const task = match?.groups?.task
    if (task !== undefined && !tasks.includes(task)) tasks.push(task)
  }
  return tasks.sort()
}

/**
 * Select conventional, unqualified Minecraft runtime tasks.
 * @param mode - Client or dedicated-server runtime.
 * @param tasks - Declared or discovered Gradle task names.
 * @returns Matching candidates in stable lexical order.
 */
export function runtimeTaskCandidates(mode: RuntimeMode, tasks: readonly string[]): string[] {
  const expected = mode === 'client'
    ? /^(?:runClient|runGame)$/iu
    : /^(?:runServer|runDedicatedServer)$/iu
  return tasks.filter(task => expected.test(task)).sort()
}
