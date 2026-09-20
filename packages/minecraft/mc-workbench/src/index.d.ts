/** Host-owned Minecraft workbench; browser consumers use a loopback-only RPC. */
import type { Context } from '@deepseek-ai/cordis';
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api';
import { MinecraftNetwork } from './network.ts';
export { networkFetch, networkJavaEnvironment, networkGradleArguments, isMinecraftNetworkFailure, automaticMinecraftNetwork, } from './network.ts';
import { MinecraftRuns } from './runtime.ts';
import { MinecraftDependencies } from './dependencies.ts';
import { MinecraftSources } from './sources.ts';
import { type ApiQueryResult } from './api-query.ts';
import { MinecraftCheckpoints } from './checkpoints.ts';
export type * from './types.ts';
export { MinecraftRuns } from './runtime.ts';
export { ensureJava, findJava, requiredJava } from './environment.ts';
export declare const name = "mc-workbench";
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        minecraftWorkbench: MinecraftWorkbench;
    }
}
/**
 * Service definition shared by UI RPC and trusted model consumers.
 */
export declare class MinecraftWorkbench {
    private readonly ctx;
    /**
     * Shared owner of development process lifecycle and retained output.
     */
    readonly runs: MinecraftRuns;
    /** Shared download and build network settings. */
    readonly network: MinecraftNetwork;
    /**
     * Shared owner of dependency previews and durable transactions.
     */
    readonly dependencies: MinecraftDependencies;
    private readonly curseforge;
    /**
     * Shared owner of read-only source operations.
     */
    readonly sources: MinecraftSources;
    /** Content-addressed project recovery independent of session-log persistence. */
    readonly checkpoints: MinecraftCheckpoints;
    constructor(ctx: Context);
    /**
     * Read exact-version class and method evidence for UI and explicit model queries.
     * @param cwd - Absolute project root.
     * @param input - Untrusted query or preview payload.
     * @param signal - Caller cancellation signal.
     * @returns Versioned API evidence with source and verification status.
     */
    queryApi(cwd: string, input: unknown, signal: AbortSignal): Promise<ApiQueryResult>;
    /**
     * Validate a loopback request and dispatch it within its registered project.
     */
    readonly handleRpc: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
    private dispatch;
    /**
     * Settle process and source owners during plugin teardown.
     */
    dispose(): Promise<void>;
}
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map