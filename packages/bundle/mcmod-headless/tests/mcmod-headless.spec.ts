/**
 * The Minecraft modding headless bundle is a static profile patch layer over
 * dsh-base and dsh-headless: it keeps the one-shot runner, adds prompt/LSP
 * rows, and disables non-v1 model-facing capabilities inherited from base.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

interface PatchRow {
  id?: string
  name?: string
  config?: unknown
  disabled?: unknown
  insert?: PatchRow[]
}

function bundleRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

function repoBundleRoot(): string {
  return fileURLToPath(new URL('../..', import.meta.url))
}

function loadPatch(path = resolve(bundleRoot(), 'cordis.patch.yml')): PatchRow[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${path} must parse to a patch list`)
  return parsed as PatchRow[]
}

function flatten(rows: readonly PatchRow[]): PatchRow[] {
  return rows.flatMap(row => [row, ...(row.insert ?? [])])
}

describe('dsh-mcmod-headless bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(bundleRoot(), 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }

    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-lsp': 'workspace:^',
      '@deepseek-ai/dsh-lsp-stdio': 'workspace:^',
      '@deepseek-ai/dsh-mcmod-agent': 'workspace:^',
      '@deepseek-ai/dsh-tool-lsp': 'workspace:^',
    })
  })

  it('adds Minecraft modding prompt, bundled skill, Java LSP, and LSP tool rows', () => {
    const rows = flatten(loadPatch())
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(byId.get('system-prompt')?.config).toMatchObject({
      persona: expect.stringContaining('Fabric + Java + Minecraft 1.21.x') as string,
    })
    expect(byId.get('mcmod-agent')).toMatchObject({
      name: '@deepseek-ai/dsh-mcmod-agent',
    })
    expect(byId.get('lsp')).toMatchObject({ name: '@deepseek-ai/dsh-lsp' })
    expect(byId.get('lsp-stdio')).toMatchObject({
      name: '@deepseek-ai/dsh-lsp-stdio',
      config: {
        servers: {
          java: {
            command: 'jdtls',
            extensionToLanguage: { '.java': 'java' },
          },
        },
      },
    })
    expect(byId.get('tool-lsp')).toMatchObject({ name: '@deepseek-ai/dsh-tool-lsp' })
    expect(JSON.stringify(byId.get('skill-filesystem')?.config)).toContain('skills/')
  })

  it('disables non-v1 inherited capabilities explicitly', () => {
    const disabled = new Set([
      'web', 'web-search-deepseek', 'tool-web',
      'workflow-worker-thread', 'tool-workflow',
      'tool-ralph',
      'subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process',
      'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent',
      'tool-subagent-fork', 'tool-subagent-report',
      'jobs', 'tool-jobs',
      'goal', 'goal-round-driver', 'command-goal', 'tool-goal',
      'tool-todo', 'plan-mode', 'tool-str-replace-editor',
    ])
    const byId = new Map(flatten(loadPatch()).map(row => [row.id, row]))

    for (const id of disabled) expect(byId.get(id)?.disabled, id).toBe(true)
  })

  it('composes without warnings after base and headless bundle layers', () => {
    const patches = [
      loadPatch(resolve(repoBundleRoot(), 'base/cordis.patch.yml')),
      loadPatch(resolve(repoBundleRoot(), 'headless/cordis.patch.yml')),
      loadPatch(),
    ]
    const warnings: string[] = []
    const rows = composeEntries(patches as unknown as PatchOptions[][], message => warnings.push(message))
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(warnings).toEqual([])
    expect(byId.get('headless-runner')?.name).toBe('@deepseek-ai/dsh-headless')
    expect(byId.get('mcmod-agent')?.name).toBe('@deepseek-ai/dsh-mcmod-agent')
    expect(byId.get('tool-lsp')?.name).toBe('@deepseek-ai/dsh-tool-lsp')
    expect(byId.get('tool-web')?.disabled).toBe(true)
    expect(byId.get('tool-workflow')?.disabled).toBe(true)
    expect(byId.get('tool-subagent')?.disabled).toBe(true)
    expect(byId.get('agent-loop')?.name).toBe('@deepseek-ai/dsh-agent-loop')
  })
})
