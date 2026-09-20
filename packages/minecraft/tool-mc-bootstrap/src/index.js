/**
 * Host-local Minecraft project bootstrap service.
 *
 * This package deliberately has no model-facing tool registration. The
 * browser wizard reaches it through the loopback-only Connection channel;
 * keeping the implementation behind that boundary prevents a model or an
 * unauthenticated LAN client from selecting arbitrary commands, URLs, or
 * write locations.
 */
import { applyBootstrapService, MinecraftBootstrapService } from "./service.js";
/** Stable plugin id used by desktop host composition. */
export const name = 'tool-mc-bootstrap';
/**
 * Connection is optional at composition time. CLI/headless profiles still
 * load the mcmod product layer, but only a Web/Desktop host owns a Connection
 * service and therefore mounts the local wizard RPC.
 */
export const inject = [];
export * from "./types.js";
export * from "./validation.js";
export * from "./catalog.js";
export * from "./template.js";
export { applyBootstrapService, MinecraftBootstrapService };
/** Cordis plugin entry point. */
export function apply(ctx) {
    ctx.inject(['connection', 'subprocess'], (host) => {
        applyBootstrapService(host);
    });
}
/** Construct the service without registering it, primarily for host tests. */
export function createMinecraftBootstrap(ctx, options) {
    return new MinecraftBootstrapService(ctx, options);
}
//# sourceMappingURL=index.js.map