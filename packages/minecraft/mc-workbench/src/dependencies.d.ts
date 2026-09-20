import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project';
import type { CurseForge } from './curseforge.ts';
import type { DependencyManifest, DependencyPlan, DependencyRole, DependencySource, ModSearchResult, ModVersion } from './types.ts';
/** Parsed mod identity, dependencies and side constraints; absent facts remain unknown. */
export interface JarDescriptor {
    modId?: string;
    name?: string;
    version?: string;
    loader?: string;
    requirements: Record<string, string[]>;
    warnings: string[];
    side?: 'client' | 'server';
    incompatible?: string[];
    requirementSides?: Record<string, 'client' | 'server'>;
    incompatibleRanges?: Record<string, string[]>;
}
/**
 * Read mod identity without executing bytecode or trusting the filename.
 * @param bytes - Archive or text bytes to inspect.
 * @returns Read mod identity without executing bytecode or trusting the filename.
 */
export declare function inspectJar(bytes: Uint8Array): JarDescriptor;
/**
 * Read nested mod metadata with a shared expansion budget; plain nested Java libraries have no mod identity.
 * @param bytes - Archive content or incremental download progress callback.
 * @returns Root and nested descriptors in archive traversal order.
 */
export declare function inspectJarTree(bytes: Uint8Array): JarDescriptor[];
/**
 * Resolves dependency previews and commits recoverable Gradle and metadata transactions.
 */
export declare class MinecraftDependencies {
    private readonly curseforge?;
    constructor(curseforge?: CurseForge | undefined);
    private readonly checkpoints;
    private readonly plans;
    private readonly busy;
    /**
     * Recover interrupted edits before reading the validated dependency lockfile.
     * @param cwd - Absolute project directory.
     * @returns Recover interrupted edits before reading the validated dependency lockfile.
     */
    read(cwd: string): Promise<DependencyManifest>;
    private recover;
    /**
     * Find Modrinth mods matching the exact game release and loader.
     * @param project - Detected loader and exact Minecraft version evidence.
     * @param query - Literal search text.
     * @param signal - Cancellation signal for the caller-owned operation.
     * @returns Find Modrinth mods matching the exact game release and loader.
     */
    search(project: DetectionResult, query: string, signal?: AbortSignal): Promise<ModSearchResult[]>;
    private releases;
    /**
     * List compatible Modrinth publications for the project.
     * @param project - Detected loader and exact Minecraft version evidence.
     * @param id - Identifier returned by the owning operation.
     * @param signal - Cancellation signal for the caller-owned operation.
     * @returns List compatible Modrinth publications for the project.
     */
    versions(project: DetectionResult, id: string, signal?: AbortSignal): Promise<ModVersion[]>;
    /**
     * Resolve the dependency graph and bind a preview to original file revisions.
     * @param cwd - Absolute project directory.
     * @param project - Detected loader and exact Minecraft version evidence.
     * @param input - Requested dependency source, role or removal/update.
     * @param signal - Cancellation signal for the caller-owned operation.
     * @returns Resolve the dependency graph and bind a preview to original file revisions.
     */
    preview(cwd: string, project: DetectionResult, input: {
        source?: DependencySource | undefined;
        role?: DependencyRole | undefined;
        removeId?: string | undefined;
        updateId?: string | undefined;
        enabled?: boolean | undefined;
    }, signal?: AbortSignal): Promise<DependencyPlan>;
    private resolve;
    private changes;
    /**
     * Apply an inspected preview only while every original file still matches.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     * @returns Apply an inspected preview only while every original file still matches.
     */
    apply(cwd: string, id: string): Promise<DependencyManifest>;
    private commit;
}
//# sourceMappingURL=dependencies.d.ts.map