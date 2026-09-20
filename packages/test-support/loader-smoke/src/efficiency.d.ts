/** Replay-derived efficiency metrics for fixed loader tasks. */
/** Aggregated provider token fields; absent fields remain unavailable. */
export interface EfficiencyTokenTotals {
    input: number | undefined;
    output: number | undefined;
    /** @deprecated Use cacheRead for new reports. */
    cache: number | undefined;
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
    reasoning: number | undefined;
}
/** Metrics folded from an existing session JSONL/replay transcript. */
export interface EfficiencyMetrics {
    toolCalls: number;
    duplicateReads: number;
    duplicateReadsByCategory: Record<string, number>;
    skillCatalogInjections: number;
    skillLoads: number;
    retries: number;
    repeatedValidationCalls: number;
    tokens: EfficiencyTokenTotals;
    requiredValidationEvents: string[];
    transcriptDigest: string;
}
/** Optional validation-event requirements for a metrics fold. */
export interface EfficiencyMetricOptions {
    /** Event types that must remain present in the replay. */
    requiredValidationTypes?: readonly string[];
}
/**
 * Parse existing session JSONL/replay text without adding a session event.
 * @param rawJsonl - complete or partial session JSONL text.
 * @param options - optional required validation event types.
 * @returns folded efficiency metrics and a stable transcript digest.
 */
export declare function parseEfficiencyMetrics(rawJsonl: string, options?: EfficiencyMetricOptions): EfficiencyMetrics;
//# sourceMappingURL=efficiency.d.ts.map