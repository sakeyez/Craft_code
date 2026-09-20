/**
 * Summarize captured Gradle diagnostics without treating missing coordinates as a network error.
 * @param output - Bounded process output containing the failure.
 * @param code - Process exit code, or null after signal termination.
 * @returns A concise cause for the failed operation.
 */
export declare function gradleFailureMessage(output: string, code: number | null): string;
/**
 * Identify a failed distribution transfer before Gradle has started.
 * @param output - Captured Wrapper failure stack.
 * @returns Whether retry needs to change the Wrapper distribution source.
 */
export declare function gradleDistributionDownloadFailed(output: string): boolean;
//# sourceMappingURL=gradle-failure.d.ts.map