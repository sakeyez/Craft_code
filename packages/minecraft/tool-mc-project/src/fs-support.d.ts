/** Bounded filesystem helpers shared by Minecraft detection and validation. */
import type { Context } from '@deepseek-ai/cordis';
import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/** Workspace and cancellation shared by tools and trusted host consumers. */
export type ProjectExecution = Pick<ToolExecution, 'agent' | 'signal'> & {
    cwd?: string;
};
/** Limits applied to bounded directory and file reads. */
export interface FsScanConfig {
    maxEntries: number;
    maxFileBytes: number;
}
/** Mutable scan budget shared by one bounded directory walk. */
export interface WalkState {
    entries: number;
    warned: boolean;
}
/** A text file read through the session filesystem provider. */
export interface TextFile {
    path: string;
    text: string;
}
/** A directory entry paired with its normalized path. */
export interface WalkedFile {
    path: string;
    entry: FsDirEntry;
}
/**
 * Resolve filesystem operations using the current session workspace.
 * @param exec - Tool execution carrying the workspace and cancellation signal.
 * @returns Provider resolve options for the current session.
 */
export declare function sessionResolveOptions(exec: ProjectExecution): {
    cwd?: string;
    signal?: AbortSignal;
};
/**
 * Return a provider error code without trusting unknown error structure.
 * @param error - Unknown provider failure.
 * @returns A string error code when present.
 */
export declare function errorCode(error: unknown): string | undefined;
/**
 * Return whether an error denotes an absent filesystem path.
 * @param error - Unknown provider failure.
 * @returns Whether the error identifies a missing path.
 */
export declare function isMissingError(error: unknown): boolean;
/**
 * Return whether the current tool execution was cancelled.
 * @param error - Unknown provider failure.
 * @param signal - Optional tool cancellation signal.
 * @returns Whether cancellation is indicated by the signal or error.
 */
export declare function isAbortedError(error: unknown, signal: AbortSignal | undefined): boolean;
/**
 * Read a UTF-8 text file without exceeding the configured byte bound.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param target - Resolved file target.
 * @param config - Read-size limit.
 * @returns Decoded UTF-8 file contents.
 */
export declare function readBoundedText(ctx: Context, exec: ProjectExecution, target: FsTarget, config: Pick<FsScanConfig, 'maxFileBytes'>): Promise<string>;
/**
 * Resolve and stat an optional path, treating only missing paths as absent.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative path.
 * @returns File target and metadata, or undefined for a missing path.
 */
export declare function optionalStat(ctx: Context, exec: ProjectExecution, path: string): Promise<{
    target: FsTarget;
    type: FsDirEntry['type'];
    size?: number;
} | undefined>;
/**
 * Read an existing text file and append bounded-read diagnostics to warnings.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative display path.
 * @param target - Resolved file target.
 * @param size - Provider-reported file size.
 * @param config - Read-size limit.
 * @param warnings - Mutable warning output.
 * @returns Decoded file or undefined when it is skipped or unreadable.
 */
export declare function readTextFile(ctx: Context, exec: ProjectExecution, path: string, target: FsTarget, size: number | undefined, config: Pick<FsScanConfig, 'maxFileBytes'>, warnings: string[]): Promise<TextFile | undefined>;
/**
 * Read an optional path when it is a regular file.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative file path.
 * @param config - Read-size limit.
 * @param warnings - Mutable warning output.
 * @returns Decoded file or undefined when absent or not a regular file.
 */
export declare function readOptionalText(ctx: Context, exec: ProjectExecution, path: string, config: Pick<FsScanConfig, 'maxFileBytes'>, warnings: string[]): Promise<TextFile | undefined>;
/**
 * List an optional directory, treating only missing directories as empty.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative directory path.
 * @returns Directory entries, or an empty list for a missing directory.
 */
export declare function listOptionalDir(ctx: Context, exec: ProjectExecution, path: string): Promise<FsDirEntry[]>;
/**
 * Walk files below a path while enforcing entry and text-read bounds.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative directory path.
 * @param state - Shared mutable traversal budget.
 * @param config - Entry and read-size limits.
 * @param warnings - Mutable warning output.
 * @param predicate - File selection predicate.
 * @returns Selected files with their provider entries.
 */
export declare function walkFiles(ctx: Context, exec: ProjectExecution, path: string, state: WalkState, config: FsScanConfig, warnings: string[], predicate: (path: string, entry: FsDirEntry) => boolean): Promise<WalkedFile[]>;
//# sourceMappingURL=fs-support.d.ts.map