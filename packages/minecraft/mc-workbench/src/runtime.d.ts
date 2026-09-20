/** Project-scoped development runs, reconnectable status and retained logs. */
import type { Context } from '@deepseek-ai/cordis';
import type { ProcessRunner } from './process.ts';
import type { CheckResult } from '@deepseek-ai/dsh-tool-mc-project';
import type { LogChunk, ProjectFacts, RunAction, RunSnapshot, RunOptions } from './types.ts';
/**
 * Owns every Minecraft development process launched by menus, tools and the test page.
 */
export declare class MinecraftRuns {
    private readonly ctx;
    private readonly operations;
    private readonly reserved;
    constructor(ctx: Context);
    /**
     * Hold a project idle while a dependency transaction changes its build inputs.
     * @param cwd - Absolute project directory.
     * @param action - Awaited mutation, including rollback on failure.
     * @returns The committed mutation result.
     */
    whileIdle<T>(cwd: string, action: () => Promise<T>): Promise<T>;
    /**
     * Discover project facts, toolchain pins and supported layout constraints.
     * @param cwd - Absolute project directory.
     * @param signal - Cancellation signal for the caller-owned operation.
     * @returns Discover project facts, toolchain pins and supported layout constraints.
     */
    inspect(cwd: string, signal?: AbortSignal): Promise<ProjectFacts>;
    /**
     * Read retained runs and classify old live records as interrupted.
     * @param cwd - Absolute project directory.
     * @returns Read retained runs and classify old live records as interrupted.
     */
    history(cwd: string): Promise<RunSnapshot[]>;
    /**
     * Reserve a project and launch one host-owned development operation.
     * @param cwd - Absolute project directory.
     * @param action - Preparation, build or explicitly authorized runtime action.
     * @param runner - Optional execution provider retaining its existing shell policy.
     * @returns Reserve a project and launch one host-owned development operation.
     * @param options - Development/artifact mode and dependency selection.
     */
    start(cwd: string, action: RunAction, runner?: ProcessRunner, options?: RunOptions): Promise<RunSnapshot>;
    /**
     * Start a new attempt after rechecking facts; historical tasks never resume a process automatically.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     * @returns Fresh run identity with rechecked inputs.
     */
    retry(cwd: string, id: string): Promise<RunSnapshot>;
    /**
     * Use the same lifecycle for approved model probes while retaining the mounted shell policy.
     * @param cwd - Absolute project directory.
     * @param mode - Requested runtime side or comparison mode.
     * @param signal - Cancellation signal for the caller-owned operation.
     * @param timeoutMs - Maximum command duration in milliseconds.
     * @returns Use the same lifecycle for approved model probes while retaining the mounted shell policy.
     * @param testMode - Development tasks or isolated artifact test; defaults to development.
     */
    check(cwd: string, mode: 'client' | 'server', signal: AbortSignal, timeoutMs?: number, testMode?: 'development' | 'artifact'): Promise<CheckResult>;
    /**
     * Cancel the selected operation and wait for process-tree and log drain.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     */
    stop(cwd: string, id: string): Promise<void>;
    /**
     * Read a bounded UTF-8 log chunk at the requested byte cursor.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     * @param cursor - UTF-8 byte offset returned by the previous log read.
     * @returns Read a bounded UTF-8 log chunk at the requested byte cursor.
     */
    logs(cwd: string, id: string, cursor: number): Promise<LogChunk>;
    /**
     * Expose a live client process identity to the trusted desktop host.
     * @param cwd - Absolute project directory.
     * @returns Expose a live client process identity to the trusted desktop host.
     */
    nativeState(cwd: string): {
        id: string;
        pid: number;
    } | undefined;
    /**
     * Write acceptance only to a recognized pending server EULA file.
     * @param cwd - Absolute project directory.
     * @param path - Workspace-relative path within the selected project or source root.
     */
    acceptEula(cwd: string, path: string): Promise<void>;
    /**
     * Cancel and settle all owned project operations during host teardown.
     */
    dispose(): Promise<void>;
    private update;
    private log;
    private gradle;
    private execute;
}
//# sourceMappingURL=runtime.d.ts.map