/** Pure Gradle task parsing shared by model tools and desktop launch controls. */
/**
 * World-load evidence; account, audio, texture and window initialization do not prove readiness.
 * @param mode - Requested runtime side or comparison mode.
 * @param text - Actual UTF-8 content to write or inspect.
 * @returns World-load evidence; account, audio, texture and window initialization do not prove readiness.
 */
export function hasMinecraftReadiness(mode, text) {
    return mode === 'server'
        ? /(?:^|\[Server thread\/INFO\].*)Done \([\d.]+s\)! For help/mu.test(text)
        : /\[Render thread\/INFO\].*(?:Loaded \d+ advancements|\[System\] \[CHAT\].*joined the game)/u.test(text);
}
/**
 * Parse task names from complete plain `gradle tasks --all` output.
 * @param text - Complete, non-truncated Gradle task output.
 * @returns Unique task names in stable lexical order.
 */
export function parseGradleTaskNames(text) {
    const tasks = [];
    for (const line of text.split(/\r?\n/u)) {
        const match = /^\s*:?(?<task>[A-Za-z][A-Za-z0-9:_-]*)\s*(?:-\s+.*)?$/u.exec(line);
        const task = match?.groups?.task;
        if (task !== undefined && !tasks.includes(task))
            tasks.push(task);
    }
    return tasks.sort();
}
/**
 * Select conventional, unqualified Minecraft runtime tasks.
 * @param mode - Client or dedicated-server runtime.
 * @param tasks - Declared or discovered Gradle task names.
 * @returns Matching candidates in stable lexical order.
 */
export function runtimeTaskCandidates(mode, tasks) {
    const expected = mode === 'client'
        ? /^(?:runClient|runGame)$/iu
        : /^(?:runServer|runDedicatedServer)$/iu;
    return tasks.filter(task => expected.test(task)).sort();
}
//# sourceMappingURL=gradle-tasks.js.map