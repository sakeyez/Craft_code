/**
 * Extract a verified ZIP to a new owned directory, rejecting links, path escapes and oversized output.
 * @param file - Verified archive path.
 * @param destination - Application-owned output path.
 * @param signal - Caller cancellation signal.
 * @param maxBytes - Maximum accepted output or response bytes.
 */
export declare function extractZipFile(file: string, destination: string, signal: AbortSignal, maxBytes?: number): Promise<void>;
//# sourceMappingURL=archive.d.ts.map