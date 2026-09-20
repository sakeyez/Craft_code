/**
 * Enforce AGPL-3.0-only declarations for CraftCode's first-party npm and Python packages.
 * @module scripts/verify-dsh-package-licenses
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DSH_PACKAGE_NAME = /^@deepseek-ai\/(?:dsh|node-addon-landlock-run)(?:-|$)/

/** Result of checking first-party workspaces and Python distributions. */
export interface DshPackageLicenseReport {
  /** Number of first-party package manifests checked. */
  packageCount: number
  /** Repository-relative diagnostics for non-AGPL declarations. */
  failures: string[]
}

function readManifest(root: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-dsh-package-licenses: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

function workspaceManifestPaths(root: string): string[] {
  const rootManifest = readManifest(root, 'package.json')
  const workspaces = rootManifest.workspaces
  if (!isStringArray(workspaces)) {
    throw new Error('verify-dsh-package-licenses: package.json workspaces must be a string array.')
  }

  const files = new Set(['package.json'])
  for (const pattern of workspaces) {
    for (const file of globSync(`${pattern}/package.json`, { cwd: root })) {
      files.add(file)
    }
  }
  return [...files].sort()
}

function printable(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Check first-party npm workspaces and Python distribution declarations.
 * @param root - absolute repository root containing the workspace package.json.
 * @returns the checked package count and every non-AGPL declaration.
 */
export function inspectDshPackageLicenses(root: string): DshPackageLicenseReport {
  let packageCount = 0
  const failures: string[] = []

  for (const file of workspaceManifestPaths(root)) {
    const manifest = readManifest(root, file)
    const name = manifest.name
    if (typeof name !== 'string' || !DSH_PACKAGE_NAME.test(name)) continue

    packageCount++
    if (manifest.license !== 'AGPL-3.0-only') {
      const normalizedFile = file.split(sep).join('/')
      failures.push(
        `${normalizedFile}: ${name} must declare "license": "AGPL-3.0-only"; found ${printable(manifest.license)}.`,
      )
    }
  }

  for (const file of ['python/sdk/pyproject.toml', 'python/sdk-runtime/pyproject.toml']) {
    if (!existsSync(resolve(root, file))) continue
    packageCount++
    if (!/^license = "AGPL-3\.0-only"$/mu.test(readFileSync(resolve(root, file), 'utf8')))
      failures.push(`${file}: first-party Python package must declare AGPL-3.0-only.`)
  }
  return { packageCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectDshPackageLicenses(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-dsh-package-licenses: non-AGPL DSH package declarations found:\n')
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-dsh-package-licenses: ${String(report.packageCount)} first-party package(s) checked; all declare AGPL-3.0-only.\n`,
    )
  }
}
