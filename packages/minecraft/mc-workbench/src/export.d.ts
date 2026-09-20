import type { RunSnapshot } from './types.ts';
/**
 * Publish a JAR, its SHA-256 and concise build/runtime evidence together in an owned export directory.
 * @param cwd - Absolute project root.
 * @param runs - Retained build and runtime records, newest first.
 * @returns Committed export directory and publication filename.
 */
export declare function exportMod(cwd: string, runs: RunSnapshot[]): Promise<{
    path: string;
    artifacts: string[];
}>;
//# sourceMappingURL=export.d.ts.map