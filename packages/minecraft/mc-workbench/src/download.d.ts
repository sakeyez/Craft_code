/**
 * Download and parse bounded JSON from an HTTPS publication endpoint.
 * @param url - HTTPS publication URL without embedded credentials.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Download and parse bounded JSON from an HTTPS publication endpoint.
 */
export declare function fetchJson(url: string, signal?: AbortSignal): Promise<unknown>;
/**
 * Download a bounded HTTPS response with cancellation and a request deadline.
 * @param url - HTTPS publication URL without embedded credentials.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @param maxBytes - Maximum accepted complete response or uncompressed size in bytes.
 * @param sha256 - Optional publisher digest checked before accepting a source.
 * @returns Download a bounded HTTPS response with cancellation and a request deadline.
 */
export declare function download(url: string, signal?: AbortSignal, maxBytes?: number, sha256?: string): Promise<Buffer>;
/**
 * Read selected ZIP entries with an aggregate uncompressed-byte limit.
 * @param bytes - Archive or text bytes to inspect.
 * @param maxBytes - Maximum accepted complete response or uncompressed size in bytes.
 * @returns Read selected ZIP entries with an aggregate uncompressed-byte limit.
 */
export declare function zipEntries(bytes: Uint8Array, maxBytes?: number): Record<string, Uint8Array>;
/**
 * Extract bounded safe ZIP entries into an application-owned directory.
 * @param bytes - Archive or text bytes to inspect.
 * @param destination - Application-owned extraction directory.
 * @param maxBytes - Maximum accepted complete response or uncompressed size in bytes.
 */
export declare function extractZip(bytes: Uint8Array, destination: string, maxBytes?: number): Promise<void>;
/**
 * Reuse only verified cache files; the supplied hash comes from the publisher manifest.
 * @param directory - Application-owned cache directory.
 * @param url - HTTPS publication URL without embedded credentials.
 * @param sha256 - Expected publisher SHA-256 digest.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Reuse only verified cache files; the supplied hash comes from the publisher manifest.
 */
export declare function cachedDownload(directory: string, url: string, sha256: string, signal?: AbortSignal): Promise<Buffer>;
//# sourceMappingURL=download.d.ts.map