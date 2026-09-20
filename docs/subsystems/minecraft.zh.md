# Minecraft 开发

[English](minecraft.md) | 中文

Minecraft 包提供 Fabric 与 NeoForge 项目创建、项目检查和开发工作台。[项目搭建](../../packages/minecraft/tool-mc-bootstrap/README.zh.md)负责版本目录与首次构建后的项目发布；[项目工具](../../packages/minecraft/tool-mc-project/README.zh.md)负责检测事实、资源校验和已授权检查；[工作台](../../packages/minecraft/mc-workbench/README.zh.md)负责保留运行记录、依赖事务及只读源码访问。

浏览器操作使用回环工作台接口。模型运行检查保留已挂载 shell 的策略及已有启动审批。选中的代码和日志通过普通会话消息发送给模型，后台输出不自动进入上下文。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
