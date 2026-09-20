import type { FileEntry, SearchHit, TextFile } from './types.ts';
/**
 * Maximum UTF-8 byte size accepted by the lightweight editor.
 */
export declare const MAX_TEXT_BYTES: number;
/**
 * Compute the SHA-256 revision used for file conflicts and artifact identity.
 * @param bytes - Archive or text bytes to inspect.
 * @returns Compute the SHA-256 revision used for file conflicts and artifact identity.
 */
export declare const hash: (bytes: string | Uint8Array) => string;
/**
 * Resolve an existing absolute workspace, rejecting filesystem aliases at the boundary.
 * @param cwd - Absolute project directory.
 * @returns Resolve an existing absolute workspace, rejecting filesystem aliases at the boundary.
 */
export declare function projectRoot(cwd: string): Promise<string>;
/**
 * Resolve a workspace-relative path without traversing symlinks, including the final component.
 * @param root - Validated absolute workspace root.
 * @param path - Workspace-relative path within the selected project or source root.
 * @param missing - Whether safe not-yet-created path components are allowed.
 * @returns Resolve a workspace-relative path without traversing symlinks, including the final component.
 */
export declare function projectPath(root: string, path: string, missing?: boolean): Promise<string>;
/**
 * Read bounded UTF-8 text with a content revision; reject binary files and path escapes.
 * @param root - Validated absolute project or source directory.
 * @param path - Relative path within that directory.
 * @param readonly - Whether the consumer must disable editing.
 * @returns Text, content hash and editing permission.
 */
export declare function readText(root: string, path: string, readonly?: boolean): Promise<TextFile>;
/**
 * Write a sibling temporary file and atomically replace only the revision that was read.
 * @param root - Validated absolute workspace root.
 * @param path - Workspace-relative path within the selected project or source root.
 * @param text - Actual UTF-8 content to write or inspect.
 * @param revision - SHA-256 revision captured when the file was read.
 * @returns Write a sibling temporary file and atomically replace only the revision that was read.
 */
export declare function saveText(root: string, path: string, text: string, revision: string): Promise<TextFile>;
/**
 * List ordinary files and directories, excluding generated/private state and symlinks.
 * @param root - Validated absolute project or source directory.
 * @param path - Relative directory to list.
 * @returns Sorted directory entries.
 */
export declare function listFiles(root: string, path?: string): Promise<FileEntry[]>;
/**
 * Search project UTF-8 text with bounded file and result counts; report incomplete scans.
 * @param root - Validated absolute project or source directory.
 * @param query - Literal case-insensitive text to find.
 * @returns Matching lines and whether the scan reached its bounds.
 */
export declare function searchFiles(root: string, query: string): Promise<{
    hits: SearchHit[];
    truncated: boolean;
}>;
//# sourceMappingURL=files.d.ts.map