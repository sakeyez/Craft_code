/** Read-only dependency sources and cancellable, verified Vineflower decompilation. */
import type { Context } from '@deepseek-ai/cordis';
import type { Dependency, SourceSnapshot, FileEntry, TextFile, SearchHit } from './types.ts';
/**
 * Reuse matching published sources or a verified decompiler cache without starting background work.
 * @param cwd - Absolute project root.
 * @param jarHashes - Hashes of the verified resolved project classpath.
 * @param symbol - Fully qualified class name in the project namespace.
 * @returns Matching published or decompiled source, when already available.
 */
export declare function cachedClassSource(cwd: string, jarHashes: ReadonlySet<string>, symbol: string): Promise<{
    text: string;
    source: string;
} | undefined>;
/**
 * Owns cancellable read-only source extraction and content-verified cache reuse.
 */
export declare class MinecraftSources {
    private readonly ctx;
    private readonly operations;
    constructor(ctx: Context);
    /**
     * Prepare read-only sources with input hashes and durable cache validation.
     * @param cwd - Absolute project directory.
     * @param dependency - Committed dependency artifact and provenance.
     * @param sourceArchive - Optional explicit path to matching source ZIP/JAR content.
     * @returns Prepare read-only sources with input hashes and durable cache validation.
     */
    start(cwd: string, dependency: Dependency, sourceArchive?: string): Promise<SourceSnapshot>;
    private operation;
    /**
     * Read the source operation belonging to the specified project.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     * @returns Read the source operation belonging to the specified project.
     */
    status(cwd: string, id: string): SourceSnapshot;
    /**
     * Abort extraction or decompilation and wait for its process to settle.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     */
    cancel(cwd: string, id: string): Promise<void>;
    /**
     * List files only after source extraction is ready.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     * @param path - Workspace-relative path within the selected project or source root.
     * @returns List files only after source extraction is ready.
     */
    files(cwd: string, id: string, path: string): Promise<FileEntry[]>;
    /**
     * Read source text with an enforced read-only flag.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     * @param path - Workspace-relative path within the selected project or source root.
     * @returns Read source text with an enforced read-only flag.
     */
    read(cwd: string, id: string, path: string): Promise<TextFile>;
    /**
     * Search within the selected source operation.
     * @param cwd - Absolute project directory.
     * @param id - Identifier returned by the owning operation.
     * @param query - Literal search text.
     * @returns Search within the selected source operation.
     */
    search(cwd: string, id: string, query: string): Promise<{
        hits: SearchHit[];
        truncated: boolean;
    }>;
    /**
     * Cancel source operations and await owned processes during teardown.
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=sources.d.ts.map