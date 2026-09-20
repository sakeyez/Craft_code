/** Host-only operation engine for deterministic Minecraft project creation. */
import type { Context } from '@deepseek-ai/cordis';
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api';
import { type BootstrapStartRequest, type CatalogEntry, type CatalogSnapshot, type OperationSnapshot, type StartRpcResponse } from './types.ts';
import { MinecraftCatalogResolver } from './catalog.ts';
/** Injectable seams for deterministic unit tests. */
export interface BootstrapServiceOptions {
    readonly prepareJava?: (major: number, signal: AbortSignal, progress: (text: string) => Promise<void>) => Promise<{
        available: boolean;
        version: number;
        executable?: string;
    }>;
    readonly catalog?: MinecraftCatalogResolver;
    readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    readonly now?: () => Date;
    readonly build?: (projectPath: string, entry: CatalogEntry, signal: AbortSignal, append: (text: string) => Promise<void>, javaExecutable: string) => Promise<void>;
    readonly wrapperJar?: (version: string, destination: string, signal: AbortSignal, append: (text: string) => Promise<void>) => Promise<void>;
    /** Application-owned cache root for wrapper jars and Gradle user home. */
    readonly cacheDirectory?: string;
}
/** Host service face, useful to trusted in-process consumers and tests. */
export interface MinecraftBootstrap {
    /**
     * Read the supported release catalog and local Java facts.
     * @param signal - Caller-owned cancellation signal.
     * @returns Current catalog entries and environment availability.
     */
    catalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
    /**
     * Create a project and retain its preparation/build operation.
     * @param request - Project identity, destination and catalog selection.
     * @param signal - Caller-owned cancellation signal.
     * @returns Identifier for polling and cancellation.
     */
    start(request: BootstrapStartRequest, signal?: AbortSignal): Promise<StartRpcResponse>;
    /**
     * Read the current or retained bootstrap operation.
     * @param operationId - Identifier returned by start.
     * @returns Latest snapshot, or undefined for an unknown operation.
     */
    status(operationId: string): OperationSnapshot | undefined;
    /**
     * Request cancellation of the selected bootstrap operation.
     * @param operationId - Identifier returned by start.
     * @returns Whether an active operation received cancellation.
     */
    cancel(operationId: string): boolean;
}
/** Build the host service and register the loopback RPC channel. */
export declare function applyBootstrapService(ctx: Context, options?: BootstrapServiceOptions): void;
/** Stateful host implementation. */
export declare class MinecraftBootstrapService implements MinecraftBootstrap {
    private readonly ctx;
    private readonly resolver;
    private readonly now;
    private readonly operations;
    private activeOperation;
    private disposed;
    private readonly options;
    private readonly cacheDirectory;
    constructor(ctx: Context, options?: BootstrapServiceOptions);
    catalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
    start(request: BootstrapStartRequest, signal?: AbortSignal): Promise<StartRpcResponse>;
    status(operationId: string): OperationSnapshot | undefined;
    cancel(operationId: string): boolean;
    dispose(): Promise<void>;
    /** RPC adapter used by HostConnectionService after envelope validation. */
    readonly handleRpc: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
    private dispatchRpc;
    private run;
    private logger;
    private ensureWrapperJar;
    private update;
    private fail;
    private publish;
}
//# sourceMappingURL=service.d.ts.map