/** Validation for persisted runs and dependency manifests. */
import { z } from 'zod'
import type { WorkbenchId } from './types.ts'

/** Validate and brand an operation UUID at the wire or persistence boundary. */
export const workbenchIdSchema = z.uuid().transform(value => value as WorkbenchId)

const path = z.string().min(1).max(4096)
const sha = z.string().regex(/^[a-f\d]{64}$/u)
/**
 * Validates persisted run identities and their corresponding log paths.
 */
export const runSchema = z
  .object({
    format: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    offline: z.boolean().optional(),
    mode: z.enum(['development', 'artifact']).optional(),
    dependencies: z.enum(['required', 'selected']).optional(),
    instance: path.optional(),
    artifact: z
      .object({
        path,
        sha256: sha,
        modId: z.string(),
        version: z.string(),
        loader: z.enum(['fabric', 'neoforge']),
        minecraft: z.string(),
        loaderVersion: z.string(),
        inputFingerprint: sha,
        requirements: z.record(z.string(), z.array(z.string())),
        nestedIds: z.array(z.string()),
        nestedVersions: z.record(z.string(), z.string()),
        checkedAt: z.iso.datetime(),
      })
      .optional(),
    evidence: z
      .object({
        processStartedAt: z.iso.datetime().optional(),
        worldReadyAt: z.iso.datetime().optional(),
        gameplay: z.literal('unverified'),
        exitReason: z.string().optional(),
      })
      .optional(),
    id: workbenchIdSchema,
    cwd: path,
    action: z.enum(['prepare', 'build', 'client', 'server']),
    phase: z.enum([
      'preparing',
      'validating',
      'building',
      'starting',
      'running',
      'ready',
      'stopping',
      'exited',
      'failed',
      'cancelled',
      'interrupted',
      'disconnected',
    ]),
    startedAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    message: z.string(),
    exitCode: z.number().int().nullable().optional(),
    logPath: path,
    eulaPath: path.optional(),
    crashReports: z.array(path).max(200).optional(),
    steps: z
      .array(
        z.object({
          phase: z.enum([
            'preparing',
            'validating',
            'building',
            'starting',
            'running',
            'ready',
            'stopping',
            'exited',
            'failed',
            'cancelled',
            'interrupted',
            'disconnected',
          ]),
          message: z.string().max(4096),
          at: z.iso.datetime({ offset: true }),
          received: z.number().int().nonnegative().optional(),
          total: z.number().int().positive().optional(),
        }),
      )
      .max(64)
      .optional(),
    failure: z
      .object({
        kind: z.enum(['network', 'rate-limit', 'checksum', 'disk-full', 'permission', 'build', 'unknown']),
        retryable: z.boolean(),
      })
      .optional(),
  })
  .refine(run => run.logPath === `.dsh/runs/${run.id}/output.log`)
/**
 * Validates locked dependency source coordinates at the storage boundary.
 */
export const dependencySourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('modrinth'), projectId: path, versionId: path }),
  z.object({
    kind: z.literal('curseforge'),
    projectId: z.number().int().positive(),
    fileId: z.number().int().positive(),
    publisherHash: z.object({ algorithm: z.literal('sha1'), value: z.string().regex(/^[a-f\d]{40}$/iu) }).optional(),
  }),
  z.object({ kind: z.literal('maven'), repository: z.url(), coordinate: path }),
  z.object({ kind: z.literal('local'), path }),
])
/**
 * Validates dependency roles, graph references and content-addressed artifact paths.
 */
export const dependencySchema = z
  .object({
    id: path,
    name: path,
    version: path,
    modId: z
      .string()
      .regex(/^[a-z][a-z\d_-]{1,63}$/u)
      .optional(),
    role: z.enum(['required', 'optional', 'test']),
    enabled: z.boolean(),
    source: dependencySourceSchema,
    sha256: sha,
    file: path,
    dependencies: z.array(path).max(100),
    automatic: z.boolean(),
    compatibility: z.enum(['verified', 'unknown']),
    warnings: z.array(z.string()),
    sourcesFile: z
      .string()
      .regex(/^\.dsh\/dependency-sources\/[a-f\d]{64}\.jar$/u)
      .optional(),
  })
  .refine(dep => dep.file === `.dsh/dependencies/${dep.sha256}.jar`)
/**
 * Validates the complete versioned dependency lockfile.
 */
export const manifestSchema = z.object({
  format: z.literal(1),
  dependencies: z.array(dependencySchema).max(100),
})

const strings = z.array(z.string())
const versionCandidate = z.object({
  value: z.string(),
  classification: z.enum(['exact', 'range']),
  source: z.string(),
  evidence: z.string(),
})
const mappingCandidate = z.object({
  type: z.string(),
  version: z.string().nullable(),
  source: z.string(),
  evidence: z.string(),
})
const projectSchema = z.object({
  workspace: z.string(),
  loader: z.enum(['fabric', 'neoforge', 'forge', 'quilt', 'architectury', 'unknown']),
  loaderSupport: z.enum(['supported', 'unsupported', 'unknown']),
  loaderEvidence: z.array(z.object({ loader: z.string(), evidence: strings })),
  minecraftVersion: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('determined'),
      value: z.string(),
      classification: z.enum(['exact', 'range']),
      candidates: z.array(versionCandidate),
    }),
    z.object({ status: z.literal('unknown'), candidates: z.array(versionCandidate) }),
    z.object({ status: z.literal('conflict'), candidates: z.array(versionCandidate) }),
  ]),
  mappings: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('determined'),
      type: z.string(),
      version: z.string().nullable(),
      candidates: z.array(mappingCandidate),
    }),
    z.object({ status: z.literal('unknown'), candidates: z.array(mappingCandidate) }),
    z.object({ status: z.literal('conflict'), candidates: z.array(mappingCandidate) }),
  ]),
  modIdCandidates: z.array(
    z.object({ id: z.string(), source: z.string(), confidence: z.enum(['high', 'medium', 'low']) }),
  ),
  languages: z.object({ java: z.boolean(), kotlin: z.boolean() }),
  mainSourceSets: z.array(z.object({ name: z.string(), java: strings, kotlin: strings, resources: strings })),
  resourceRoots: strings,
  mixinConfigs: z.array(z.object({ path: z.string(), source: z.string() })),
  datagenClues: z.array(z.object({ kind: z.string(), source: z.string(), detail: z.string() })),
  recommendedValidationCommands: strings,
  gradleTaskCandidates: strings,
  inspected: z.object({
    gradleFiles: strings,
    metadataFiles: strings,
    sourceRoots: strings,
    resourceRoots: strings,
  }),
  warnings: strings,
  scanComplete: z.boolean(),
})
const textFileSchema = z.object({ path, text: z.string(), revision: sha, readonly: z.boolean() })
const filesSchema = z.array(z.object({ path, name: z.string(), directory: z.boolean() })).max(5000)
const searchSchema = z.object({
  hits: z.array(z.object({ path, line: z.number().int().positive(), text: z.string() })),
  truncated: z.boolean(),
})
const sourceSchema = z.object({
  id: workbenchIdSchema,
  dependencyId: path,
  status: z.enum(['running', 'ready', 'failed', 'cancelled']),
  provenance: z.string(),
  error: z.string().optional(),
})
const javaSchema = z.object({
  executable: z.string().optional(),
  major: z.number().int(),
  managed: z.boolean(),
  available: z.boolean(),
})
const checkpointSchema = z.object({
  format: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  kind: z.enum(['automatic', 'manual', 'transaction', 'before-restore']),
  label: z.string(),
  fingerprint: sha,
  files: z.record(z.string(), sha),
})
const responseSchemas: Record<string, z.ZodType> = {
  export: z.object({ path, artifacts: strings }),
  checkpoints: z.array(checkpointSchema),
  'checkpoint-create': checkpointSchema,
  'checkpoint-preview': z.object({
    id: z.uuid(),
    fingerprint: sha,
    changes: z.array(
      z.object({
        path,
        before: sha.nullable(),
        after: sha.nullable(),
        beforeText: z.string().max(65536).optional(),
        afterText: z.string().max(65536).optional(),
      }),
    ),
  }),
  'checkpoint-restore': z.null(),
  'checkpoint-delete': z.null(),
  'resource-preview': z.object({
    path,
    revision: sha,
    draft: z.boolean(),
    kind: z.enum(['png', 'generated', 'model', 'unsupported']),
    images: z.record(z.string(), z.string().startsWith('data:image/png;base64,')),
    elements: z
      .array(
        z.object({
          from: z.tuple([z.number(), z.number(), z.number()]),
          to: z.tuple([z.number(), z.number(), z.number()]),
          faces: z.record(
            z.string(),
            z.object({
              texture: z.string(),
              uv: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
              rotation: z.number().optional(),
              tintindex: z.number().optional(),
            }),
          ),
        }),
      )
      .max(128),
    missing: strings,
    unsupported: strings,
    references: z.array(z.object({ path, line: z.number().int(), text: z.string() })),
    issues: z.array(z.object({ path, message: z.string() })),
    generatedSources: strings,
  }),
  'api-query': z.object({
    symbol: z.string(),
    version: z.string(),
    namespace: z.string(),
    verified: z.boolean(),
    source: z.string(),
    cached: z.boolean(),
    text: z.string(),
  }),
  snapshot: z.object({
    facts: z.object({
      project: projectSchema,
      java: z.object({
        executable: z.string().optional(),
        major: z.number().int(),
        managed: z.boolean(),
        available: z.boolean(),
      }),
      javaRoles: z
        .object({
          gradle: javaSchema,
          compiler: javaSchema,
          game: javaSchema,
          basis: z.object({ gradle: z.string(), compiler: z.string(), game: z.string() }),
        })
        .optional(),
      gradleVersion: z.string().optional(),
      supported: z.boolean(),
      reason: z.string().optional(),
    }),
    runs: z.array(runSchema),
    dependencies: manifestSchema,
  }),
  runs: z.array(runSchema),
  start: runSchema,
  retry: runSchema,
  stop: z.null(),
  eula: z.null(),
  logs: z.object({ text: z.string(), cursor: z.number().int().nonnegative(), complete: z.boolean() }),
  'native-state': z.object({ id: workbenchIdSchema, pid: z.number().int().positive() }).nullable(),
  files: filesSchema,
  read: textFileSchema,
  save: textFileSchema,
  search: searchSchema,
  head: z.string(),
  'mod-search': z.array(z.object({ id: path, name: z.string(), description: z.string() })),
  'mod-versions': z.array(z.object({ id: path, name: z.string(), version: z.string() })),
  'dependency-preview': z.object({
    id: workbenchIdSchema,
    dependencies: z.array(dependencySchema),
    changes: z.array(z.object({ path, before: z.string().nullable(), after: z.string().nullable() })),
    warnings: strings,
  }),
  'dependency-apply': manifestSchema,
  'source-start': sourceSchema,
  'source-status': sourceSchema,
  'source-cancel': z.null(),
  'source-files': filesSchema,
  'source-read': textFileSchema,
  'source-search': searchSchema,
}

/**
 * Validate a workbench response before browser or desktop consumers use its fields.
 * @param endpoint - Requested workbench operation.
 * @param value - Untrusted decoded response payload.
 * @returns The validated response, with unknown fields removed.
 */
export function parseWorkbenchResponse(endpoint: string, value: unknown): unknown {
  const schema = responseSchemas[endpoint]
  if (!schema) throw new Error('未知工作台响应类型。')
  return schema.parse(value)
}
