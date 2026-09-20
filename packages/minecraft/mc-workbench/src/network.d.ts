import type { Context } from '@deepseek-ai/cordis';
import { type Dispatcher } from 'undici';
import { z } from 'zod';
/** Persisted user preference; credentials are deliberately unsupported. */
export declare const NetworkSettingsSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        auto: "auto";
        direct: "direct";
        proxy: "proxy";
    }>>;
    proxyUrl: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
/** Network preference applied to newly started operations. */
export type NetworkSettings = z.infer<typeof NetworkSettingsSchema>;
/**
 * Exact publication mappings; arbitrary Maven repositories are never rewritten.
 * @param input - Official HTTPS publication URL.
 * @returns Ordered mirror and official URLs.
 */
export declare function minecraftDownloadSources(input: string): string[];
/** One immutable settings snapshot and its reusable connection pools. */
export declare class NetworkOperation {
    readonly settings: NetworkSettings;
    private readonly inheritedProxy?;
    private readonly agents;
    private readonly successful;
    constructor(settings: NetworkSettings, inheritedProxy?: string | undefined, agents?: Map<string, Dispatcher>, successful?: Map<string, {
        source: string;
        proxy?: string;
        until: number;
    }>);
    private proxy;
    /**
     * Supply the installer's streaming transport; its transfer layer owns retries.
     * @returns Shared proxy-aware dispatcher with bounded connections.
     */
    installerDispatcher(): Promise<Dispatcher>;
    /**
     * Fetch an HTTPS resource with bounded retries and per-origin fallback.
     * @param input - Official resource URL.
     * @param init - HTTP options and caller cancellation.
     * @param maxBytes - Complete payload size limit.
     * @param sha256 - Optional official digest; a mismatch rejects that route.
     * @returns Fully read, validated response.
     * @param sink - Streaming response consumer responsible for validation and commit.
     * @param headersForAttempt - Fresh Range headers based on retained partial bytes.
     */
    fetch(input: string, init?: RequestInit, maxBytes?: number, sha256?: string, sink?: (response: Response) => Promise<void>, headersForAttempt?: () => HeadersInit): Promise<Response>;
    /**
     * Java reads JVM proxy properties rather than HTTP_PROXY environment variables.
     * @param directFallback - Use direct transport only when automatic mode permits it.
     * @returns Child-only JVM options.
     */
    javaEnvironment(directFallback?: boolean): Promise<NodeJS.ProcessEnv>;
}
/** Per-host settings owner; async operations retain the configuration they started with. */
export declare class MinecraftNetwork {
    private readonly ctx;
    private readonly agents;
    private readonly successful;
    constructor(ctx: Context);
    /**
     * Read the effective preference without exposing proxy credentials.
     * @returns Validated network settings.
     */
    read(): NetworkSettings;
    /**
     * Persist a validated user preference through the settings service.
     * @param input - Untrusted preference payload.
     * @returns Committed preference.
     */
    save(input: unknown): Promise<NetworkSettings>;
    /**
     * Start a task with immutable network settings and trusted launch proxy inputs.
     * @param task - Work retaining this operation context through asynchronous calls.
     * @returns The task result.
     */
    run<T>(task: () => T): T;
    /**
     * Probe representative metadata endpoints without downloading toolchains.
     * @param signal - Caller cancellation.
     * @returns Per-resource connection results and Java proxy compatibility.
     */
    check(signal: AbortSignal): Promise<{
        name: string;
        ok: boolean;
        message: string;
    }[]>;
}
/**
 * Shared download boundary for Minecraft consumers inside an operation scope.
 * @param url - Official HTTPS resource URL.
 * @param init - HTTP options and cancellation.
 * @param maxBytes - Payload byte limit.
 * @param sha256 - Optional official digest.
 * @returns Verified bounded response.
 */
export declare function networkFetch(url: string, init?: RequestInit, maxBytes?: number, sha256?: string): Promise<Response>;
/**
 * Share proxy policy with XMCL's file-transfer implementation without wrapping its retry loop.
 * @returns Shared proxy-aware dispatcher with bounded connections.
 * @returns Shared proxy-aware dispatcher with bounded connections.
 */
export declare function installerDispatcher(): Promise<Dispatcher>;
/**
 * Stream a bounded artifact through the operation's routes; the sink owns verification and partial files.
 * @param url - Official HTTPS publication URL.
 * @param init - Request options and cancellation.
 * @param maxBytes - Maximum accepted output or response bytes.
 * @param sink - Streaming response consumer responsible for validation and commit.
 * @param headers - Fresh headers for each transfer attempt.
 */
export declare function networkTransfer(url: string, init: RequestInit, maxBytes: number, sink: (response: Response) => Promise<void>, headers: () => HeadersInit): Promise<void>;
/**
 * Child-only proxy settings for the current Minecraft operation.
 * @param directFallback - Automatic-mode direct retry.
 * @returns JVM options for the next subprocess.
 */
export declare function networkJavaEnvironment(directFallback?: boolean): Promise<NodeJS.ProcessEnv>;
/**
 * Explicit user transport choices never fall back to a different transport.
 * @returns Whether the current operation allows automatic transport selection.
 */
export declare function automaticMinecraftNetwork(): boolean;
/**
 * Only dependency transport failures qualify for an automatic build retry.
 * @param output - Captured Gradle failure output.
 * @returns Whether the output identifies a retryable network failure.
 */
export declare function isMinecraftNetworkFailure(output: string): boolean;
/**
 * Owned init script uses Loom's published MirrorUtil extra properties, not project edits.
 * @param loader - Detected project loader.
 * @param officialOnly - Skip the application mirror script for an official-source retry.
 * @returns Gradle arguments referencing application-owned configuration.
 */
export declare function networkGradleArguments(loader: string, officialOnly?: boolean): Promise<string[]>;
//# sourceMappingURL=network.d.ts.map