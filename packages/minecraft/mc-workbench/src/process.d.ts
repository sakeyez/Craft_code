/** Managed subprocess execution with incremental UTF-8 output and tree cancellation. */
import type { Context } from '@deepseek-ai/cordis';
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess';
/**
 * Process arguments, cancellation and output callbacks for a single owned command.
 */
export interface ProcessOptions {
    cwd: string;
    argv: string[];
    signal: AbortSignal;
    env?: NodeJS.ProcessEnv;
    output?: (text: string, stream: 'stdout' | 'stderr') => Promise<void>;
    spawned?: (handle: SubprocessHandle) => void;
    maxBytes?: number;
}
/**
 * Execution provider used by desktop subprocesses or policy-controlled model shell commands.
 */
export type ProcessRunner = (options: ProcessOptions) => Promise<{
    exitCode: number | null;
    text: string;
    truncated: boolean;
}>;
/**
 * Resolves after process close and output drain; cancellation waits for the owned tree.
 * @param ctx - Host context providing the required capabilities.
 * @param options - Command identity, environment, output and cancellation callbacks.
 * @returns Resolves after process close and output drain; cancellation waits for the owned tree.
 */
export declare function runProcess(ctx: Context, options: ProcessOptions): Promise<{
    exitCode: number | null;
    text: string;
    truncated: boolean;
}>;
//# sourceMappingURL=process.d.ts.map