/**
 * Host-local Minecraft project bootstrap service.
 *
 * This package deliberately has no model-facing tool registration. The
 * browser wizard reaches it through the loopback-only Connection channel;
 * keeping the implementation behind that boundary prevents a model or an
 * unauthenticated LAN client from selecting arbitrary commands, URLs, or
 * write locations.
 */
import type { Context } from '@deepseek-ai/cordis';
import { applyBootstrapService, MinecraftBootstrapService, type BootstrapServiceOptions, type MinecraftBootstrap } from './service.ts';
/** Stable plugin id used by desktop host composition. */
export declare const name = "tool-mc-bootstrap";
/**
 * Connection is optional at composition time. CLI/headless profiles still
 * load the mcmod product layer, but only a Web/Desktop host owns a Connection
 * service and therefore mounts the local wizard RPC.
 */
export declare const inject: string[];
export * from './types.ts';
export * from './validation.ts';
export * from './catalog.ts';
export * from './template.ts';
export { applyBootstrapService, MinecraftBootstrapService };
export type { BootstrapServiceOptions, MinecraftBootstrap };
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host-only deterministic Minecraft project creation service. */
        minecraftBootstrap: MinecraftBootstrap;
    }
    interface Events {
        /**
         * Progress snapshots forwarded to reconnecting browser clients.
         * @mode emit
         * @param snapshot - Current operation progress for browser refresh.
         */
        'minecraft-bootstrap/progress'(snapshot: unknown): void;
    }
}
/** Cordis plugin entry point. */
export declare function apply(ctx: Context): void;
/** Construct the service without registering it, primarily for host tests. */
export declare function createMinecraftBootstrap(ctx: Context, options?: BootstrapServiceOptions): MinecraftBootstrapService;
//# sourceMappingURL=index.d.ts.map