/** Validate package ownership by the root Host and Client TypeScript aggregates. */

import { existsSync, globSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

type AggregateFace = 'host' | 'client'

interface ProjectConfig {
  readonly references?: ReadonlyArray<{ readonly path?: unknown }>
}

const OFFICIAL_PACKAGE_MANIFESTS = [
  'packages/*/*/package.json',
  'apps/*/package.json',
] as const

/** Neutral leaves intentionally seeded into both programs for Client-side tests. */
const SHARED_AGGREGATE_PACKAGES: Readonly<Record<string, readonly AggregateFace[]>> = {
  'packages/compaction/compaction': ['host', 'client'],
  'packages/host/webserver': ['host', 'client'],
  'packages/typert/registry': ['host', 'client'],
}

/**
 * Find TypeScript packages missing their root aggregate registration.
 *
 * Ordinary packages name their package project directly in one root aggregate.
 * A package with Host and Client leaf configs instead requires both leaves to
 * be reachable from the matching root aggregate.
 *
 * @param root - Repository root containing the aggregate tsconfigs.
 * @returns Repo-relative diagnostics for missing or duplicate registrations.
 */
export function collectAggregateMembershipViolations(root: string): string[] {
  const aggregateRoots: Readonly<Record<AggregateFace, string>> = {
    host: resolve(root, 'tsconfig.host.json'),
    client: resolve(root, 'tsconfig.client.json'),
  }
  const direct = {
    host: directProjectRoots(aggregateRoots.host),
    client: directProjectRoots(aggregateRoots.client),
  }
  const reachable = {
    host: reachableConfigs(aggregateRoots.host),
    client: reachableConfigs(aggregateRoots.client),
  }
  const errors: string[] = []

  for (const manifest of globSync(OFFICIAL_PACKAGE_MANIFESTS, { cwd: root }).sort()) {
    const packageRoot = resolve(root, dirname(manifest))
    const packagePath = repoPath(root, packageRoot)
    const hostLeaf = resolve(packageRoot, 'tsconfig.host.json')
    const clientLeaf = resolve(packageRoot, 'tsconfig.client.json')
    if (existsSync(hostLeaf) && existsSync(clientLeaf)) {
      if (!reachable.host.has(hostLeaf)) {
        errors.push(`${packagePath}: tsconfig.host.json must be reachable from tsconfig.host.json`)
      }
      if (!reachable.client.has(clientLeaf)) {
        errors.push(`${packagePath}: tsconfig.client.json must be reachable from tsconfig.client.json`)
      }
      continue
    }
    if (!existsSync(resolve(packageRoot, 'tsconfig.json'))) continue

    const actual = (['host', 'client'] as const).filter(face => direct[face].has(packageRoot))
    const expected = SHARED_AGGREGATE_PACKAGES[packagePath] ?? ['host']
    if (SHARED_AGGREGATE_PACKAGES[packagePath] === undefined && actual.length === 1) continue
    if (sameFaces(actual, expected)) continue
    const expectation = SHARED_AGGREGATE_PACKAGES[packagePath] === undefined
      ? 'exactly one root aggregate'
      : `the ${expected.join(' and ')} root aggregates`
    errors.push(`${packagePath}: TypeScript package must be registered directly in ${expectation}; found ${formatFaces(actual)}`)
  }

  return errors.sort()
}

function directProjectRoots(configPath: string): Set<string> {
  return new Set(projectReferences(configPath).map(reference => dirname(referenceConfigPath(configPath, reference))))
}

function reachableConfigs(rootConfig: string): Set<string> {
  const visited = new Set<string>()
  const pending = [rootConfig]
  for (let configPath = pending.pop(); configPath !== undefined; configPath = pending.pop()) {
    if (visited.has(configPath) || !existsSync(configPath)) continue
    visited.add(configPath)
    for (const reference of projectReferences(configPath)) {
      pending.push(referenceConfigPath(configPath, reference))
    }
  }
  return visited
}

function projectReferences(configPath: string): string[] {
  const read = ts.readConfigFile(configPath, path => ts.sys.readFile(path))
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  }
  return ((read.config as ProjectConfig).references ?? [])
    .map(reference => reference.path)
    .filter((path): path is string => typeof path === 'string')
}

function referenceConfigPath(sourceConfig: string, reference: string): string {
  const target = resolve(dirname(sourceConfig), reference)
  return target.endsWith('.json') ? target : resolve(target, 'tsconfig.json')
}

function sameFaces(actual: readonly AggregateFace[], expected: readonly AggregateFace[]): boolean {
  return actual.length === expected.length && actual.every((face, index) => face === expected[index])
}

function formatFaces(faces: readonly AggregateFace[]): string {
  return faces.length === 0 ? 'none' : faces.join(' and ')
}

function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}
