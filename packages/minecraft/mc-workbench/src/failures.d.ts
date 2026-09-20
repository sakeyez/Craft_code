/** Stable failure categories shared by retained tasks and download consumers. */
import type { RunFailure } from './types.ts';
/**
 * Classify failures without retaining network credentials or arbitrary response bodies.
 * @param error - Failure raised by the owning operation.
 * @returns Failure category and whether explicit retry is useful.
 */
export declare function classifyFailure(error: unknown): RunFailure;
//# sourceMappingURL=failures.d.ts.map