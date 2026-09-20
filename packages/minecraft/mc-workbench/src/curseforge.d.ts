/** CurseForge's authenticated metadata API; download restrictions are never bypassed. */
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project';
declare const fileSchema: z.ZodObject<{
    id: z.ZodNumber;
    modId: z.ZodNumber;
    displayName: z.ZodString;
    fileName: z.ZodString;
    downloadUrl: z.ZodOptional<z.ZodNullable<z.ZodURL>>;
    gameVersions: z.ZodArray<z.ZodString>;
    hashes: z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        algo: z.ZodNumber;
    }, z.core.$strip>>;
    dependencies: z.ZodArray<z.ZodObject<{
        modId: z.ZodNumber;
        relationType: z.ZodNumber;
    }, z.core.$strip>>;
    isAvailable: z.ZodBoolean;
}, z.core.$strip>;
/** Publisher file coordinates and hashes, validated before dependency resolution. */
export type CurseFile = z.infer<typeof fileSchema>;
/** Resolve credentials only for a bounded metadata request; callers receive publication data alone. */
export declare class CurseForge {
    private readonly ctx;
    constructor(ctx: Context);
    private request;
    private filter;
    /**
     * Search only Minecraft mods for the pinned project version and loader.
     * @param project - Detected loader, version and mappings evidence.
     * @param query - Literal search text.
     * @param signal - Caller cancellation signal.
     * @returns Compatible publication search results.
     */
    search(project: DetectionResult, query: string, signal?: AbortSignal): Promise<{
        id: string;
        name: string;
        description: string;
    }[]>;
    /**
     * Read an available exact file; never constructs an alternative CDN URL.
     * @param project - Detected loader, version and mappings evidence.
     * @param projectId - CurseForge publication project ID.
     * @param fileId - Exact CurseForge publication file ID.
     * @param signal - Caller cancellation signal.
     * @returns Validated exact publication metadata with an allowed download URL.
     */
    file(project: DetectionResult, projectId: number, fileId: number, signal?: AbortSignal): Promise<CurseFile>;
    private compatible;
    /**
     * Compatible publication list; required dependency resolution uses these exact file IDs.
     * @param project - Detected loader, version and mappings evidence.
     * @param projectId - CurseForge publication project ID.
     * @param signal - Caller cancellation signal.
     * @returns Compatible available publication files.
     */
    files(project: DetectionResult, projectId: number, signal?: AbortSignal): Promise<CurseFile[]>;
}
export {};
//# sourceMappingURL=curseforge.d.ts.map