/** JSON contracts for the project workbench. Paths are relative to the registered workspace. */
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project/types'
import type { ArtifactEvidence } from './artifact.ts'
export type { ApiQueryResult } from './api-query.ts'
export type { ResourcePreview } from './resource-preview.ts'
export type { ProjectCheckpoint, RestorePreview } from './checkpoints.ts'

declare const workbenchIdBrand: unique symbol
/** Opaque identity of a host-owned run, dependency preview or source operation. */
export type WorkbenchId = string & { readonly [workbenchIdBrand]: true }

/**
 * Development operation requested by the player or an approved model probe.
 */
export type RunAction = 'prepare' | 'build' | 'client' | 'server'
/** Development tasks or an isolated test of the published artifact. */
export interface RunOptions {
  offline?: boolean
  mode?: 'development' | 'artifact'
  dependencies?: 'required' | 'selected'
}
/** Retained failure classification; retry always revalidates project inputs. */
export interface RunFailure {
  kind: 'network' | 'rate-limit' | 'checksum' | 'disk-full' | 'permission' | 'build' | 'unknown'
  retryable: boolean
}
/** Bounded history of concrete lifecycle transitions, including byte progress. */
export interface RunStep {
  phase: RunPhase
  message: string
  at: string
  received?: number | undefined
  total?: number | undefined
}
/**
 * Observable preparation, build and game lifecycle phase.
 */
export type RunPhase =
  | 'preparing'
  | 'validating'
  | 'building'
  | 'starting'
  | 'running'
  | 'ready'
  | 'stopping'
  | 'exited'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'disconnected'
/**
 * Verified Java major, executable origin and availability.
 */
export interface JavaEnvironment {
  executable?: string
  major: number
  managed: boolean
  available: boolean
}
/**
 * Detected project evidence and compatible development environment status.
 */
export interface ProjectFacts {
  project: DetectionResult
  java: JavaEnvironment
  javaRoles?: {
    gradle: JavaEnvironment
    compiler: JavaEnvironment
    game: JavaEnvironment
    basis: { gradle: string; compiler: string; game: string }
  }
  gradleVersion?: string
  supported: boolean
  reason?: string
}
/**
 * Durable project run identity, lifecycle and retained evidence locations.
 */
export interface RunSnapshot {
  format?: 2 | 3 | 4 | undefined
  offline?: boolean | undefined
  id: WorkbenchId
  cwd: string
  action: RunAction
  phase: RunPhase
  startedAt: string
  updatedAt: string
  message: string
  exitCode?: number | null | undefined
  logPath: string
  eulaPath?: string | undefined
  crashReports?: string[] | undefined
  steps?: RunStep[] | undefined
  failure?: RunFailure | undefined
  mode?: 'development' | 'artifact' | undefined
  dependencies?: 'required' | 'selected' | undefined
  instance?: string | undefined
  artifact?: ArtifactEvidence | undefined
  evidence?:
    | {
      processStartedAt?: string | undefined
      worldReadyAt?: string | undefined
      gameplay: 'unverified'
      exitReason?: string | undefined
    }
    | undefined
}
/**
 * UTF-8 output and the next byte cursor for incremental log reads.
 */
export interface LogChunk {
  text: string
  cursor: number
  complete: boolean
}
/**
 * A workspace-relative file or directory shown in the project tree.
 */
export interface FileEntry {
  path: string
  name: string
  directory: boolean
}
/**
 * Bounded UTF-8 content with a revision hash and read-only provenance.
 */
export interface TextFile {
  path: string
  text: string
  revision: string
  readonly: boolean
}
/**
 * A matching source line with its relative path and one-based line number.
 */
export interface SearchHit {
  path: string
  line: number
  text: string
}
/**
 * Whether a dependency is required, optional or restricted to development tests.
 */
export type DependencyRole = 'required' | 'optional' | 'test'
/**
 * Locked publication coordinates or a managed local artifact path.
 */
export type DependencySource =
  | { kind: 'modrinth'; projectId: string; versionId: string }
  | {
    kind: 'curseforge'
    projectId: number
    fileId: number
    publisherHash?: { algorithm: 'sha1'; value: string } | undefined
  }
  | { kind: 'maven'; repository: string; coordinate: string }
  | { kind: 'local'; path: string }
/**
 * Resolved dependency identity, artifact hash, role and prerequisite graph.
 */
export interface Dependency {
  id: string
  name: string
  version: string
  modId?: string | undefined
  role: DependencyRole
  enabled: boolean
  source: DependencySource
  sha256: string
  file: string
  dependencies: string[]
  automatic: boolean
  compatibility: 'verified' | 'unknown'
  warnings: string[]
  sourcesFile?: string | undefined
}
/**
 * Versioned lockfile for dependencies owned by the workbench.
 */
export interface DependencyManifest {
  format: 1
  dependencies: Dependency[]
}
/**
 * Exact before and after text used for preview, conflict detection and rollback.
 */
export interface FileChange {
  path: string
  before: string | null
  after: string | null
}
/**
 * A preview token binding dependency artifacts to exact file revisions.
 */
export interface DependencyPlan {
  id: WorkbenchId
  dependencies: Dependency[]
  changes: FileChange[]
  warnings: string[]
}
/**
 * Modrinth project identity and description for a filtered search result.
 */
export interface ModSearchResult {
  id: string
  name: string
  description: string
}
/**
 * A compatible publication offered for a selected Modrinth project.
 */
export interface ModVersion {
  id: string
  name: string
  version: string
}
/**
 * Read-only source operation progress and artifact/mapping provenance.
 */
export interface SourceSnapshot {
  id: WorkbenchId
  dependencyId: string
  status: 'running' | 'ready' | 'failed' | 'cancelled'
  provenance: string
  error?: string
}
/**
 * Host project facts, retained runs and committed dependency state.
 */
export interface WorkbenchSnapshot {
  facts: ProjectFacts
  runs: RunSnapshot[]
  dependencies: DependencyManifest
}
