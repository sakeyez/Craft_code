/** Pure Gradle task parsing shared by model tools and desktop launch controls. */
/**
 * Minecraft runtime side used to select conventional Gradle launch tasks.
 */
export type RuntimeMode = 'client' | 'server';
/**
 * World-load evidence; account, audio, texture and window initialization do not prove readiness.
 * @param mode - Requested runtime side or comparison mode.
 * @param text - Actual UTF-8 content to write or inspect.
 * @returns World-load evidence; account, audio, texture and window initialization do not prove readiness.
 */
export declare function hasMinecraftReadiness(mode: RuntimeMode, text: string): boolean;
/**
 * Parse task names from complete plain `gradle tasks --all` output.
 * @param text - Complete, non-truncated Gradle task output.
 * @returns Unique task names in stable lexical order.
 */
export declare function parseGradleTaskNames(text: string): string[];
/**
 * Select conventional, unqualified Minecraft runtime tasks.
 * @param mode - Client or dedicated-server runtime.
 * @param tasks - Declared or discovered Gradle task names.
 * @returns Matching candidates in stable lexical order.
 */
export declare function runtimeTaskCandidates(mode: RuntimeMode, tasks: readonly string[]): string[];
//# sourceMappingURL=gradle-tasks.d.ts.map