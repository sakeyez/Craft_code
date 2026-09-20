/** Exact-classpath API lookup; external mappings remain explicitly unverified. */
import type { Context } from '@deepseek-ai/cordis';
import type { BuildFacts } from './artifact.ts';
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project';
/** Query result provenance; a cached external symbol never becomes local proof. */
export interface ApiQueryResult {
    symbol: string;
    version: string;
    namespace: string;
    verified: boolean;
    source: string;
    cached: boolean;
    text: string;
}
/**
 * Record resolved classpath identities after a build, binding lookup to exact project inputs.
 * @param cwd - Absolute project root.
 * @param facts - Resolved Gradle archive and classpath facts.
 * @param project - Detected loader, version and mappings evidence.
 * @param fingerprint - Expected hash of the protected project input inventory.
 * @param java - Selected JVM executable or major required by this operation.
 */
export declare function recordApiClasspath(cwd: string, facts: BuildFacts, project: DetectionResult, fingerprint: string, java: number): Promise<void>;
/**
 * Read method descriptors through javap from a verified classpath; never converts naming schemes.
 * @param ctx - Host context with filesystem and managed subprocess services.
 * @param cwd - Absolute project root.
 * @param input - Untrusted query or preview payload.
 * @param signal - Caller cancellation signal.
 * @returns Versioned API evidence with source and verification status.
 */
export declare function queryMinecraftApi(ctx: Context, cwd: string, input: unknown, signal: AbortSignal): Promise<ApiQueryResult>;
//# sourceMappingURL=api-query.d.ts.map