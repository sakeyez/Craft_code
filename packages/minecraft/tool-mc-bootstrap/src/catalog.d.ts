import type { CatalogEntry, CatalogSnapshot, JavaProbe } from './types.ts';
/** Default catalog cache location; never touches global Gradle config. */
export declare function defaultCatalogCachePath(): string;
/** Network timeout for one catalog request. */
export declare const CATALOG_TIMEOUT_MS = 20000;
/** Overall online refresh budget; a cache or completed loader family wins after it expires. */
export declare const CATALOG_REFRESH_TIMEOUT_MS = 45000;
/** A cache older than this is displayed as stale. */
export declare const CATALOG_STALE_MS: number;
/** Injectable fetch boundary used by tests and offline hosts. */
export type CatalogFetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Injectable Java probe boundary. */
export type JavaProbeFn = (signal?: AbortSignal) => Promise<JavaProbe>;
/** Optional resolver seams, kept small so unit tests never need the network. */
export interface CatalogResolverOptions {
    readonly cachePath?: string;
    readonly fetch?: CatalogFetch;
    readonly now?: () => Date;
    readonly probeJava?: JavaProbeFn;
    /** Online refresh budget override for deterministic timeout tests. */
    readonly refreshTimeoutMs?: number;
}
export interface NeoForgeMdkRecipe {
    readonly pluginVersion: string;
    readonly gradleVersion: string;
}
/** Parse and filter Fabric Meta game versions without trusting the server. */
export declare function parseFabricGameVersions(value: unknown): string[];
/** Parse the loader endpoint into trusted primitive fields. */
export declare function parseFabricLoaderVersions(value: unknown): Array<{
    loader: string;
    intermediary: string;
}>;
/** Parse Yarn mappings for one game version from Fabric Meta. */
export declare function parseFabricYarnVersions(value: unknown, minecraftVersion: string): string[];
/** Select the newest Fabric API publication that explicitly targets a game version. */
export declare function parseFabricApiVersion(xml: string, minecraftVersion: string): string | undefined;
/** Parse NeoForge Maven metadata into stable game/loader pairs. */
export declare function parseNeoForgeMetadata(xml: string): Array<{
    minecraftVersion: string;
    loaderVersion: string;
}>;
/** Parse the official Maven directory index when metadata.xml is unavailable. */
export declare function parseNeoForgeDirectoryIndex(html: string): Array<{
    minecraftVersion: string;
    loaderVersion: string;
}>;
/** Parse the pinned NeoGradle plugin and wrapper recipe from an official MDK. */
export declare function parseNeoForgeMdkRecipe(buildGradle: string, wrapperProperties: string): NeoForgeMdkRecipe | undefined;
/** Extract supported NeoGradle MDK game lines from the official GitHub organization. */
export declare function parseNeoForgeMdkRepositories(value: unknown): string[];
/** Read the stable NeoForge coordinate pinned by an official MDK. */
export declare function parseNeoForgeMdkLoader(properties: string, minecraftVersion: string): string | undefined;
/** Build a deterministic Fabric entry from the API response. */
export declare function fabricEntry(minecraftVersion: string, loaderVersion: string, intermediary: string, yarn: string, apiVersion?: string): CatalogEntry;
/** Build a deterministic NeoForge entry. */
export declare function neoForgeEntry(minecraftVersion: string, loaderVersion: string, recipe?: NeoForgeMdkRecipe): CatalogEntry;
/** Keep one newest stable entry per loader/game line. */
export declare function normalizeCatalogEntries(entries: readonly CatalogEntry[]): CatalogEntry[];
/** Resolver with online-first/cache-fallback semantics. */
export declare class MinecraftCatalogResolver {
    private readonly cachePath;
    private readonly doFetch;
    private readonly now;
    private readonly probeJava;
    private readonly refreshTimeoutMs;
    constructor(options?: CatalogResolverOptions);
    /**
     * Resolve an online catalog, merging successful loader families into the cache.
     * @param signal - Caller cancellation.
     * @param refresh - False permits a fresh cache without an online refresh.
     * @returns Available versions with cache provenance and Java status.
     */
    load(signal?: AbortSignal, refresh?: boolean): Promise<CatalogSnapshot>;
    /**
     * Return verified cached entries immediately, without waiting for an online refresh.
     * @returns Usable cached catalog, or undefined when no valid cache exists.
     */
    cached(): Promise<CatalogSnapshot | undefined>;
    private fetchOnlineWithinBudget;
    private fetchOnline;
    private fetchFabricEntries;
    private fetchNeoForgeEntries;
    private resolveNeoForgeMdk;
    private getJson;
    /**
     * Read the official MDK repository list through a small, deterministic page
     * window.  A failed later page keeps entries already collected, while the
     * hard page/row cap prevents an unbounded GitHub response from consuming the
     * catalog refresh deadline.
     */
    private fetchNeoForgeMdkRepositories;
    private getText;
    private getFabricYarnVersion;
    private getFabricApiMetadata;
    private request;
}
/** Probe Java without a shell and report the major version from stderr/stdout. */
export declare function probeJava(signal?: AbortSignal): Promise<JavaProbe>;
/** Parse `java -version` output, including legacy `1.8.0` notation. */
export declare function parseJavaMajor(output: string): number | undefined;
//# sourceMappingURL=catalog.d.ts.map