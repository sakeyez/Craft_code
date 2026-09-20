/** Runtime guards for Minecraft bootstrap inputs and cached wire records. */
import type { BootstrapLoader, CatalogEntry } from './types.ts';
/** Event name forwarded over the host event stream. */
export declare const BOOTSTRAP_PROGRESS_EVENT: "minecraft-bootstrap/progress";
/** Return the JDK required by a supported Minecraft version. */
export declare function jdkForMinecraft(version: string): 17 | 21 | undefined;
/** Stable Minecraft versions visible in v1 (1.20.1 through stable 1.21.x). */
export declare function isSupportedMinecraftVersion(version: string): boolean;
/** Reject prereleases and the accidental 26.x API family. */
export declare function isStableMinecraftVersion(version: string, stable?: boolean): boolean;
/**
 * Return whether a Minecraft line has an official NeoForge MDK in v1.
 *
 * NeoForge's published lines do not include 1.20.1.  Keep this policy in one
 * guard so Maven rows, GitHub MDK names, cache records, and RPC entries cannot
 * drift into presenting an inferred 1.20.1 target.
 */
export declare function isSupportedNeoForgeMinecraftVersion(version: string): boolean;
/** Canonical, collision-resistant catalog id. */
export declare function catalogEntryId(loader: BootstrapLoader, minecraftVersion: string, loaderVersion: string): string;
/** Safe model/package identifier. */
export declare function isValidModId(value: string): boolean;
/** Conservative Java package syntax accepted by the generated template. */
export declare function isValidPackageName(value: string): boolean;
/** Human-facing name bound to a small, deterministic input. */
export declare function isValidModName(value: string): boolean;
/** Directory names are a single non-special path component. */
export declare function isValidDirectoryName(value: string): boolean;
/** Derive the default final directory name from a mod id/name. */
export declare function deriveDirectoryName(modName: string, modId: string): string;
/** Type guard for the small RPC payload objects. */
export declare function recordPayload(value: unknown): Record<string, unknown> | undefined;
/** Hexadecimal SHA-256 values accepted at the catalog/download boundary. */
export declare function isSha256(value: unknown): value is string;
/** Defensive runtime check for cached or remotely parsed catalog entries. */
export declare function isCatalogEntry(value: unknown): value is CatalogEntry;
//# sourceMappingURL=validation.d.ts.map