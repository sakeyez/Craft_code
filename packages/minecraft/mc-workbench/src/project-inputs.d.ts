/** A bounded hash inventory; no cache, runtime state or credential file is included. */
export interface ProjectInputs {
    fingerprint: string;
    files: Record<string, string>;
}
/**
 * Hash source, resource and build inputs; unreadable files make the inventory incomplete and fail the operation.
 * @param cwd - Absolute project root.
 * @param signal - Caller cancellation signal.
 * @returns Protected path hashes and their stable inventory fingerprint.
 */
export declare function projectInputs(cwd: string, signal?: AbortSignal): Promise<ProjectInputs>;
//# sourceMappingURL=project-inputs.d.ts.map