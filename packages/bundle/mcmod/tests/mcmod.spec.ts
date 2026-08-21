/**
 * The Minecraft modding bundle is a static profile patch layer: it selects
 * the shipped mcmod preset and contributes the Java LSP host rows.
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
  insert?: PatchRow[]
}

function bundleRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

function loadPatch(): PatchRow[] {
  const parsed = yaml.load(
    readFileSync(resolve(bundleRoot(), 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('mcmod patch must parse to a patch list')
  return parsed as PatchRow[]
}

describe('dsh-mcmod bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(bundleRoot(), 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }

    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const rows = loadPatch().flatMap(patch => patch.insert ?? [])
    expect(rows.map(row => row.id)).toEqual(['lsp', 'lsp-stdio'])
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-lsp': 'workspace:^',
      '@deepseek-ai/dsh-lsp-stdio': 'workspace:^',
    })
  })

  it('selects the Minecraft modding preset and configures Java through stdio LSP', () => {
    const patch = loadPatch()
    const presetPatch = patch.find(row => row.id === 'agent-presets')
    const lspRows = patch.flatMap(row => row.insert ?? [])
    const lspStdio = lspRows.find(row => row.id === 'lsp-stdio')

    expect(presetPatch?.config).toMatchObject({ default: 'mcmod' })
    expect(lspRows.find(row => row.id === 'lsp')).toMatchObject({ name: '@deepseek-ai/dsh-lsp' })
    expect(lspStdio).toMatchObject({
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
  })

  it('does not expose disabled v1 surfaces', () => {
    const forbidden = new Set([
      'tool-web',
      'tool-workflow',
      'tool-ralph',
      'tool-subagent',
      'tool-subagent-control',
      'tool-todo',
      'tool-goal',
    ])
    const ids = loadPatch().flatMap(row => [row.id, ...(row.insert ?? []).map(inserted => inserted.id)])

    expect(ids.filter((id): id is string => typeof id === 'string' && forbidden.has(id))).toEqual([])
  })

  it('composes without warnings after base and web-app bundle layers', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const patches = [
      yaml.load(readFileSync(resolve(root, 'bundle/base/cordis.patch.yml'), 'utf8'), { schema: entryListSchema }),
      yaml.load(readFileSync(resolve(root, 'bundle/web-app/cordis.patch.yml'), 'utf8'), { schema: entryListSchema }),
      loadPatch(),
    ]
    const warnings: string[] = []
    const rows = composeEntries(patches as unknown as PatchOptions[][], message => warnings.push(message))
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(warnings).toEqual([])
    expect(byId.get('agent-presets')?.config).toMatchObject({ default: 'mcmod' })
    expect(byId.get('lsp')?.name).toBe('@deepseek-ai/dsh-lsp')
    expect(byId.get('lsp-stdio')?.name).toBe('@deepseek-ai/dsh-lsp-stdio')
  })
})
