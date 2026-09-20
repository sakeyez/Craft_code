import { z } from 'zod';
declare const manifest: z.ZodObject<{
    format: z.ZodLiteral<1>;
    id: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    kind: z.ZodEnum<{
        automatic: "automatic";
        manual: "manual";
        transaction: "transaction";
        "before-restore": "before-restore";
    }>;
    label: z.ZodString;
    fingerprint: z.ZodString;
    files: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strip>;
declare const change: z.ZodObject<{
    path: z.ZodString;
    before: z.ZodNullable<z.ZodString>;
    after: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** Complete checkpoint identity and protected file revisions. */
export type ProjectCheckpoint = z.infer<typeof manifest>;
/** Restore preview bound to the current protected file inventory. */
export interface RestorePreview {
    id: string;
    fingerprint: string;
    changes: (z.infer<typeof change> & {
        beforeText?: string;
        afterText?: string;
    })[];
}
/** Own checkpoint creation and restoration without changing Git state. */
export declare class MinecraftCheckpoints {
    private static readonly active;
    private static readonly edits;
    /**
     * Serialize protected project edits against restoration.
     * @param cwd - Absolute project root.
     * @param work - Protected mutation including its preceding checkpoint.
     * @returns The mutation result after earlier edits settle.
     */
    mutate<T>(cwd: string, work: () => Promise<T>): Promise<T>;
    private exclusive;
    /**
     * List only complete checkpoint manifests; manual checkpoints are not pruned.
     * @param cwd - Absolute project root.
     * @returns Complete retained checkpoint records, newest first.
     */
    list(cwd: string): Promise<ProjectCheckpoint[]>;
    /**
     * Create a complete checkpoint before allowing a protected mutation.
     * @param cwd - Absolute project root.
     * @param kind - Checkpoint retention and creation reason.
     * @param label - User-visible checkpoint label.
     * @param signal - Caller cancellation signal.
     * @returns Published complete checkpoint manifest.
     */
    create(cwd: string, kind: ProjectCheckpoint['kind'], label: string, signal?: AbortSignal): Promise<ProjectCheckpoint>;
    private capture;
    /**
     * Compare protected paths before any restore; additions are included in the preview.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     * @returns File differences bound to the current project fingerprint.
     */
    preview(cwd: string, id: string): Promise<RestorePreview>;
    /**
     * Save the current state and atomically replace each file under a recoverable journal.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     * @param fingerprint - Expected hash of the protected project input inventory.
     */
    restore(cwd: string, id: string, fingerprint: string): Promise<void>;
    private replace;
    private recover;
    /**
     * Remove an explicitly selected checkpoint; shared content remains available to other records.
     * @param cwd - Absolute project root.
     * @param id - Identity returned by the owning operation.
     */
    remove(cwd: string, id: string): Promise<void>;
}
export {};
//# sourceMappingURL=checkpoints.d.ts.map