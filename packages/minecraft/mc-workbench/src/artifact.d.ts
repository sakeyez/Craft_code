import { z } from 'zod';
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project';
/** Resolved Gradle facts, written by an application-owned inspection task after a successful build. */
export declare const buildFactsSchema: z.ZodObject<{
    artifacts: z.ZodArray<z.ZodObject<{
        task: z.ZodString;
        path: z.ZodString;
        classifier: z.ZodString;
    }, z.core.$strip>>;
    modules: z.ZodArray<z.ZodObject<{
        group: z.ZodString;
        name: z.ZodString;
        version: z.ZodString;
    }, z.core.$strip>>;
    classpath: z.ZodArray<z.ZodString>;
    resources: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/** Exact build output facts for instance installation and local API lookup. */
export type BuildFacts = z.infer<typeof buildFactsSchema>;
/** Artifact identity and the project inputs for which it was accepted. Runtime results remain separate. */
export interface ArtifactEvidence {
    path: string;
    sha256: string;
    modId: string;
    version: string;
    loader: 'fabric' | 'neoforge';
    minecraft: string;
    loaderVersion: string;
    inputFingerprint: string;
    requirements: Record<string, string[]>;
    nestedIds: string[];
    nestedVersions: Record<string, string>;
    checkedAt: string;
}
/**
 * Reject ambiguous, development or mismatched artifacts rather than guessing from file modification time.
 * @param cwd - Absolute project root.
 * @param project - Detected loader, version and mappings evidence.
 * @param facts - Resolved Gradle archive and classpath facts.
 * @param fingerprint - Expected hash of the protected project input inventory.
 * @returns Validated artifact bound to current project inputs.
 */
export declare function acceptArtifact(cwd: string, project: DetectionResult, facts: BuildFacts, fingerprint: string): Promise<ArtifactEvidence>;
/**
 * Generate a Gradle task that records actual archive outputs and resolved dependency coordinates.
 * @param task - Unique Gradle inspection task name.
 * @param destination - Application-owned output path.
 * @returns Gradle script that writes bounded build facts.
 */
export declare function buildInspectionScript(task: string, destination: string): string;
//# sourceMappingURL=artifact.d.ts.map