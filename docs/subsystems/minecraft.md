# Minecraft development

English | [中文](minecraft.zh.md)

The Minecraft packages provide Fabric and NeoForge project creation, project checks and the development workbench. [Bootstrap](../../packages/minecraft/tool-mc-bootstrap/README.md) owns release catalogs and first-build publication. [Project tools](../../packages/minecraft/tool-mc-project/README.md) own detected facts, resource validation and approved checks. The [workbench](../../packages/minecraft/mc-workbench/README.md) owns retained runs, dependency transactions and read-only source access.

Browser actions use the loopback workbench contract. Model runtime checks keep the mounted shell policy and their existing launch approval. Selected code and logs reach the model through ordinary session messages; background output remains outside its context.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxminecraftbootstrap--minecraftbootstrap"></a>

### `ctx.minecraftBootstrap` — `MinecraftBootstrap`

Host service face, useful to trusted in-process consumers and tests.

```ts cordis-catalog
/**
 * Read the supported release catalog and local Java facts.
 * @param signal - Caller-owned cancellation signal.
 * @returns Current catalog entries and environment availability.
 */
catalog(signal?: AbortSignal): Promise<CatalogSnapshot>

/**
 * Create a project and retain its preparation/build operation.
 * @param request - Project identity, destination and catalog selection.
 * @param signal - Caller-owned cancellation signal.
 * @returns Identifier for polling and cancellation.
 */
start(request: BootstrapStartRequest, signal?: AbortSignal): Promise<StartRpcResponse>

/**
 * Read the current or retained bootstrap operation.
 * @param operationId - Identifier returned by start.
 * @returns Latest snapshot, or undefined for an unknown operation.
 */
status(operationId: string): OperationSnapshot | undefined

/**
 * Request cancellation of the selected bootstrap operation.
 * @param operationId - Identifier returned by start.
 * @returns Whether an active operation received cancellation.
 */
cancel(operationId: string): boolean
```

Source: [`packages/minecraft/tool-mc-bootstrap/src/service.ts`](../../packages/minecraft/tool-mc-bootstrap/src/service.ts)

<a id="ctxminecraftruntime--minecraftruntimebridge"></a>

### `ctx.minecraftRuntime` — `MinecraftRuntimeBridge`

Optional host runtime used by approved model launches and desktop controls.

```ts cordis-catalog
/**
 * Run an approved, bounded development launch through the mounted shell and retain its logs.
 * @param cwd - Absolute project directory.
 * @param mode - Client or dedicated-server runtime.
 * @param signal - Caller-owned cancellation signal.
 * @param timeoutMs - Per-command timeout in milliseconds.
 * @param testMode - Development tasks or isolated artifact test, defaulting to development.
 * @returns Preflight and readiness outcome with the retained log path.
 */
check(cwd: string, mode: RuntimeMode, signal: AbortSignal, timeoutMs?: number, testMode?: 'development' | 'artifact'): Promise<CheckResult>
```

Source: [`packages/minecraft/tool-mc-project/src/index.ts`](../../packages/minecraft/tool-mc-project/src/index.ts)

<a id="ctxminecraftworkbench--minecraftworkbench"></a>

### `ctx.minecraftWorkbench` — `MinecraftWorkbench`

Service definition shared by UI RPC and trusted model consumers.

```ts cordis-catalog
/**
 * Read exact-version class and method evidence for UI and explicit model queries.
 * @param cwd - Absolute project root.
 * @param input - Untrusted query or preview payload.
 * @param signal - Caller cancellation signal.
 * @returns Versioned API evidence with source and verification status.
 */
queryApi(cwd: string, input: unknown, signal: AbortSignal): Promise<ApiQueryResult>

/**
 * Settle process and source owners during plugin teardown.
 */
async dispose(): Promise<void>
```

Source: [`packages/minecraft/mc-workbench/src/index.ts`](../../packages/minecraft/mc-workbench/src/index.ts)

<a id="minecraft-bootstrap-events"></a>

### `minecraft-bootstrap/*` events

<a id="minecraft-bootstrapprogress--emit"></a>

#### `minecraft-bootstrap/progress` — emit

Host-local Minecraft bootstrap snapshots; payload is validated by the client feature.

```ts cordis-catalog
/**
 * Host-local Minecraft bootstrap snapshots; payload is validated by the client feature.
 * @mode emit
 * @param snapshot - Current host bootstrap operation snapshot.
 */
'minecraft-bootstrap/progress'(snapshot: unknown): void
```

Source: [`packages/api/remotes/src/types.ts`](../../packages/api/remotes/src/types.ts)

<a id="minecraft-bootstrapprogress--emit"></a>

#### `minecraft-bootstrap/progress` — emit

Progress snapshots forwarded to reconnecting browser clients.

```ts cordis-catalog
/**
 * Progress snapshots forwarded to reconnecting browser clients.
 * @mode emit
 * @param snapshot - Current operation progress for browser refresh.
 */
'minecraft-bootstrap/progress'(snapshot: unknown): void
```

Source: [`packages/minecraft/tool-mc-bootstrap/src/index.ts`](../../packages/minecraft/tool-mc-bootstrap/src/index.ts)
<!-- END GENERATED cordis-surface -->
