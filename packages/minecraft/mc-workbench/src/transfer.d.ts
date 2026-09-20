/** Publisher identity and destination for one immutable artifact. */
export interface ArtifactDownload {
    url: string;
    destination: string;
    digest: {
        algorithm: 'sha1' | 'sha256' | 'sha512';
        value: string;
    };
    maxBytes: number;
    signal?: AbortSignal;
    progress?: (received: number, total?: number) => void;
}
/**
 * Hash a file without retaining it in memory.
 * @param path - File path to hash.
 * @param algorithm - Publisher digest algorithm.
 * @returns Lowercase hexadecimal file digest.
 */
export declare function fileDigest(path: string, algorithm?: string): Promise<string>;
/**
 * Download, verify and atomically publish a file. Cancellation detaches one consumer;
 * the final consumer cancels the transfer and retains resumable bytes.
 * @param request - Immutable artifact identity, destination and caller cancellation.
 * @returns Verified committed artifact path.
 */
export declare function downloadArtifact(request: ArtifactDownload): Promise<string>;
//# sourceMappingURL=transfer.d.ts.map