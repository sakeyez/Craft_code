/** Loader support policy and Gradle task selection for the Minecraft profile. */
/** Loader evidence understood by the detector. */
export type Loader = 'architectury' | 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'unknown';
/** Whether this profile may apply loader-specific behavior. */
export type LoaderSupport = 'supported' | 'unsupported' | 'unknown';
interface DatagenClue {
    kind: string;
    source: string;
    detail: string;
}
/**
 * Return the profile support status for a detected loader.
 * @param loader - Detected loader.
 * @returns Profile support classification.
 */
export declare function loaderSupport(loader: Loader): LoaderSupport;
/**
 * Return the conventional datagen task for a loader.
 * @param loader - Detected loader.
 * @returns Conventional task name, when defined.
 */
export declare function preferredDatagenTask(loader: Loader): string | undefined;
/**
 * Select declared datagen tasks while preserving explicit project evidence.
 * @param loader - Detected loader.
 * @param tasks - Declared Gradle task names.
 * @returns Unambiguous datagen task candidates.
 */
export declare function datagenTaskCandidates(loader: Loader, tasks: readonly string[]): string[];
/**
 * Build bounded validation command recommendations from detected project facts.
 * @param loader - Detected loader.
 * @param support - Loader support classification.
 * @param hasGradle - Whether root Gradle files were found.
 * @param hasWrapper - Whether a Gradle wrapper was found.
 * @param datagen - Datagen evidence collected during detection.
 * @param taskCandidates - Declared Gradle task names.
 * @returns Recommended generic and loader-specific commands.
 */
export declare function validationCommands(loader: Loader, support: LoaderSupport, hasGradle: boolean, hasWrapper: boolean, datagen: readonly DatagenClue[], taskCandidates: readonly string[]): string[];
export {};
//# sourceMappingURL=loader-support.d.ts.map