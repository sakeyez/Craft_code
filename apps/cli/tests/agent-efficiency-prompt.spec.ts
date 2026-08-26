import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { CODING_WORKFLOW_POLICY } from '@deepseek-ai/dsh-system-prompt/src/index.ts'

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const GUIDANCE_MARKERS = [
  'write a short scope definition',
  'Research only for a concrete decision',
  'batch independent reads or searches',
  'Do not reread unchanged files',
  'make a small number of concentrated edits',
  'A user request for a deep audit overrides this default',
  'Prioritize high-probability, high-impact issues',
  'Record low-probability, low-impact risks without blocking delivery',
  'Do not narrate every tool call',
] as const

const SHARED_POLICY_MARKERS = [
  'First define the scope, acceptance criteria, and explicit non-goals',
  'Batch independent read-only',
  'Do not reread unchanged files',
  'Research APIs only to answer a concrete unresolved question',
  'Form the complete change set',
  'smallest relevant compile or test',
  'security, persistence, concurrency, lifecycle',
  'A requested deep audit overrides ordinary efficiency guidance',
  'existing sandbox and permission escalation policy',
  'fixed tool-call, read, validation, context, or model-capability limits',
  'Progress updates report confirmed facts',
] as const

function presetPersona(id: string): string {
  const parsed: unknown = load(
    readFileSync(join(CONFIG_DIR, 'agent-presets', id, 'agent.cordis.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError(`${id} preset must parse to an entry array`)
  const persona = parsed.find((entry): entry is { id: string; config?: { text?: unknown } } => (
    typeof entry === 'object'
      && entry !== null
      && (entry as { id?: unknown }).id === 'persona'
  ))
  const text = persona?.config?.text
  if (typeof text !== 'string') throw new TypeError(`${id} preset persona must have text`)
  return text
}

function presetWorkflowEnabled(id: string): boolean {
  const parsed: unknown = load(
    readFileSync(join(CONFIG_DIR, 'agent-presets', id, 'agent.cordis.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError(`${id} preset must parse to an entry array`)
  const persona = parsed.find((entry): entry is { id: string; config?: { workflowPolicy?: unknown } } => (
    typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === 'persona'
  ))
  return persona?.config?.workflowPolicy === true
}

function sourceText(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8')
}

function expectGuidance(text: string, subject: string): void {
  for (const marker of GUIDANCE_MARKERS) expect(text, `${subject}: ${marker}`).toContain(marker)
  expect(text.toLowerCase(), `${subject}: no Minecraft-specific guidance`).not.toContain('minecraft')
}

describe('default coding-agent efficiency guidance', () => {
  it('keeps one shared strategy enabled in every coding CLI preset persona', () => {
    for (const marker of SHARED_POLICY_MARKERS) expect(CODING_WORKFLOW_POLICY).toContain(marker)
    for (const id of ['standard', 'code', 'cordis', 'minimal']) {
      expect(presetWorkflowEnabled(id), `preset ${id}`).toBe(true)
      expect(presetPersona(id)).not.toContain('Do not reread unchanged files')
    }
    expect(presetWorkflowEnabled('mcmod'), 'preset mcmod').toBe(true)
  })

  it('keeps standalone default personas aligned without changing explicit overrides', () => {
    expectGuidance(sourceText('examples/headless-agent/cordis.yml'), 'headless-agent')
    expectGuidance(sourceText('examples/acp-agent/cordis.yml'), 'acp-agent')
    expectGuidance(sourceText('examples/jsonrpc-agent/cordis.yml'), 'jsonrpc-agent')
    expectGuidance(sourceText('examples/jsonrpc-agent/minimal.cordis.yml'), 'jsonrpc-agent minimal')
    expect(sourceText('examples/jsonrpc-agent/cordis.yml')).toContain('process.env.DSH_SYSTEM_PROMPT ??')
    expect(sourceText('examples/jsonrpc-agent/minimal.cordis.yml')).toContain('process.env.DSH_SYSTEM_PROMPT ??')
  })

  it('pins the strategy in the assembled keyless ACP system prompt', () => {
    expectGuidance(
      sourceText('examples/acp-agent/tests/snapshots/text-turn/system-prompt.expected.md'),
      'ACP text-turn system prompt',
    )
  })
})
