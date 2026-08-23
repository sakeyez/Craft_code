/** Keep the Web preset's Minecraft skills byte-identical to the headless bundle. */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(root, 'apps/cli/config/agent-presets/mcmod/skills')
const targetRoot = resolve(root, 'packages/bundle/mcmod-headless/skills')

function relativeFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return []
  const files: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(relative(rootDir, path).split(sep).join('/'))
    }
  }
  visit(rootDir)
  return files.sort()
}

/**
 * Report every missing, extra, or byte-different generated skill file.
 * @param source - Canonical Web preset skill directory.
 * @param target - Headless bundle skill directory.
 * @returns Repo-independent diagnostics for stale generated content.
 */
export function collectSkillSyncViolations(source: string, target: string): string[] {
  const sourceFiles = relativeFiles(source)
  const targetFiles = relativeFiles(target)
  const sourceSet = new Set(sourceFiles)
  const targetSet = new Set(targetFiles)
  const errors: string[] = []
  for (const file of sourceFiles) {
    if (!targetSet.has(file)) {
      errors.push(`missing generated Minecraft skill file: ${file}`)
      continue
    }
    const sourceBytes = readFileSync(join(source, file))
    const targetBytes = readFileSync(join(target, file))
    if (!sourceBytes.equals(targetBytes)) errors.push(`generated Minecraft skill differs from source: ${file}`)
  }
  for (const file of targetFiles) {
    if (!sourceSet.has(file)) errors.push(`extra generated Minecraft skill file: ${file}`)
  }
  return errors.sort()
}

/** Generate the bundle skill tree from the canonical Web preset tree. */
export function syncSkills(source = sourceRoot, target = targetRoot): void {
  const sourceFiles = relativeFiles(source)
  mkdirSync(target, { recursive: true })
  for (const file of sourceFiles) {
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, readFileSync(join(source, file)))
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const path = join(target, entry.name)
    if (entry.isDirectory() && !sourceFiles.some(file => file.startsWith(`${entry.name}/`))) {
      rmSync(path, { recursive: true, force: true })
    }
  }
}

/** Run generation or the byte-level freshness gate. */
export function main(): void {
  if (process.argv.includes('--check')) {
    const errors = collectSkillSyncViolations(sourceRoot, targetRoot)
    if (errors.length > 0) {
      console.error(errors.join('\n'))
      process.exitCode = 1
    }
    return
  }
  syncSkills()
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
