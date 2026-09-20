/** Browser-safe contracts for the host-local Minecraft project bootstrapper. */

import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Loaders supported by the wizard. */
export type BootstrapLoader = 'fabric' | 'neoforge'

/** A fully resolved, stable loader/version combination offered by the host. */
export interface CatalogEntry {
  /** Stable id echoed by start; clients never submit dependency URLs. */
  readonly entryId: string
  readonly loader: BootstrapLoader
  readonly minecraftVersion: string
  readonly loaderVersion: string
  /** Yarn/intermediary for Fabric, or the official mapping label for NeoForge. */
  readonly mappingsVersion: string
  /** Fabric API version, or the NeoForge API coordinate. */
  readonly apiVersion: string
  /** Loom or NeoGradle userdev plugin version. */
  readonly pluginVersion: string
  readonly gradleVersion: string
  /** Official SHA-256 for the Gradle distribution when published. */
  readonly gradleSha256: string
  /** Official SHA-256 for the downloaded wrapper jar when known. */
  readonly wrapperSha256: string
  readonly requiredJdk: 17 | 21
  readonly stable: true
}

/** Java facts shown beside the version picker. */
export interface JavaProbe {
  readonly available: boolean
  readonly version?: number
  readonly executable?: string
  readonly message?: string
}

/** Catalog response, including cache provenance. */
export interface CatalogSnapshot {
  readonly entries: readonly CatalogEntry[]
  readonly fetchedAt?: string
  readonly cached: boolean
  readonly stale: boolean
  readonly java: JavaProbe
  readonly error?: string
}

/** Validated values submitted by the browser. */
export interface BootstrapStartRequest {
  readonly entryId: string
  readonly parentDirectory: string
  readonly directoryName: string
  readonly modName: string
  readonly modId: string
  readonly packageName: string
}

/** Operation lifecycle. */
export type OperationStatus = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled'

/** Coarse progress stages rendered by the wizard. */
export type OperationStage =
  | 'validate'
  | 'java'
  | 'generate'
  | 'gradle-download'
  | 'dependencies'
  | 'build'
  | 'finalize'
  | 'done'

/** Reconnectable operation state. Keep wire logs bounded. */
export interface OperationSnapshot {
  readonly operationId: string
  readonly status: OperationStatus
  readonly stage: OperationStage
  readonly progress: number
  readonly projectPath?: string
  readonly entry?: CatalogEntry
  readonly failureCode?: string
  readonly message?: string
  readonly logTail: string
  readonly updatedAt: string
}

/** Response to `start`. */
export interface StartRpcResponse { readonly operationId: string }

/** JSON payload accepted by the status and cancel endpoints. */
export interface OperationRpcRequest { readonly operationId: string }

/** Narrow JSON-safe snapshot for Cordis's forwarded event contract. */
export type BootstrapProgressEvent = [snapshot: OperationSnapshot]

// Keep the event's argument type visible to the Cordis forwarding type gate
// without importing any host implementation into browser code.
export type { JsonValue }
