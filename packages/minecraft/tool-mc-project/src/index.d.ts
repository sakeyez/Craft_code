import type { DetectionResult, ResourceValidationResult } from './types.ts';
export type { DetectionResult, ResourceValidationResult } from './types.ts';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RuntimeMode } from './gradle-tasks.ts';
/**
 * Cordis plugin name.
 */
export declare const name = "tool-mc-project";
/**
 * Services required by the detector.
 */
export declare const inject: string[];
/**
 * Model-facing tool name.
 */
export declare const DETECT_MC_PROJECT = "detect_mc_project";
/**
 * Model-facing Minecraft resource validator tool name.
 */
export declare const VALIDATE_MC_RESOURCES = "validate_mc_resources";
/**
 * Model-facing Minecraft project check runner tool name.
 */
export declare const RUN_MC_CHECK = "run_mc_check";
/**
 * Tool configuration.
 */
export interface Config {
    /**
     * Maximum directory entries walked while discovering source/resource and
     * metadata clues. When the limit is reached, the result carries a warning and
     * returns the facts already found.
     */
    maxEntries?: number;
    /**
     * Maximum bytes read from one candidate text file. Larger files are skipped
     * with a warning instead of being partially parsed.
     */
    maxFileBytes?: number;
    /**
     * Maximum UTF-8 bytes retained inline from each command stdout/stderr tail in
     * `run_mc_check` step summaries. The shell executor may already have
     * truncated or spilled the stream before this bound is applied.
     */
    maxOutputSummaryBytes?: number;
    /**
     * Maximum stdout bytes captured while discovering Gradle tasks. A truncated
     * task list is treated as inconclusive rather than selecting a guessed task.
     */
    maxTaskDiscoveryBytes?: number;
}
/**
 * Schemastery configuration for the detector.
 */
export declare const Config: z<Config>;
type CheckStepStatus = 'passed' | 'failed' | 'skipped';
interface OutputSummary {
    text: string;
    truncated: boolean;
    spillPath?: string;
}
interface SandboxSummary {
    mode: string;
    denied: boolean;
    enforcement?: string;
    runnerFailed?: boolean;
}
interface CheckStepResult {
    step: string;
    command?: string;
    status: CheckStepStatus;
    exitCode: number | null;
    stdout: OutputSummary;
    stderr: OutputSummary;
    timedOut: boolean;
    aborted: boolean;
    signal: string | null;
    sandbox?: SandboxSummary;
    message?: string;
}
/**
 * Structured command outcomes with failing phase and next-action guidance.
 */
export interface CheckResult {
    commands: string[];
    exitCode: number | null;
    steps: CheckStepResult[];
    failedStep: string | null;
    suggestedNextAction: string | null;
}
/**
 * Optional host runtime used by approved model launches and desktop controls.
 */
export interface MinecraftRuntimeBridge {
    /**
     * Run an approved, bounded development launch through the mounted shell and retain its logs.
     * @param cwd - Absolute project directory.
     * @param mode - Client or dedicated-server runtime.
     * @param signal - Caller-owned cancellation signal.
     * @param timeoutMs - Per-command timeout in milliseconds.
     * @param testMode - Development tasks or isolated artifact test, defaulting to development.
     * @returns Preflight and readiness outcome with the retained log path.
     */
    check(cwd: string, mode: RuntimeMode, signal: AbortSignal, timeoutMs?: number, testMode?: 'development' | 'artifact'): Promise<CheckResult>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        minecraftRuntime: MinecraftRuntimeBridge;
    }
}
/**
 * Register the Minecraft project tools.
@param ctx - plugin context carrying tool and filesystem services.
@param rawConfig - optional scan and output-summary bounds.
 */
export declare function apply(ctx: Context, rawConfig?: Config): void;
/**
 * Inspect a trusted host workspace using the same evidence parser as detect_mc_project.
 * @param ctx - Host context providing the required capabilities.
 * @param cwd - Absolute project directory.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Inspect a trusted host workspace using the same evidence parser as detect_mc_project.
 */
export declare function inspectMinecraftProject(ctx: Context, cwd: string, signal?: AbortSignal): Promise<DetectionResult>;
/**
 * Run bounded static resource validation without launching Gradle or Minecraft.
 * @param ctx - Host context providing the required capabilities.
 * @param cwd - Absolute project directory.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Run bounded static resource validation without launching Gradle or Minecraft.
 */
export declare function validateMinecraftProject(ctx: Context, cwd: string, signal?: AbortSignal): Promise<ResourceValidationResult>;
//# sourceMappingURL=index.d.ts.map