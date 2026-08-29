import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { projectSettingsText } from '../src/index.ts'

const roots: string[] = []

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('project settings prompt', () => {
  it('loads prompt text and bounded prerequisite paths without scanning them', () => {
    const root = join(tmpdir(), `dsh-project-settings-${randomUUID()}`)
    roots.push(root)
    mkdirSync(join(root, '.dsh'), { recursive: true })
    writeFileSync(join(root, '.dsh', 'project.yaml'), JSON.stringify({
      systemPrompt: 'Prefer the project registration style.',
      prerequisites: [{ name: 'Example API', path: 'C:\\mods\\example.jar' }],
    }))
    expect(projectSettingsText(root)).toContain('Prefer the project registration style.')
    expect(projectSettingsText(root)).toContain('Example API: C:\\mods\\example.jar')
  })

  it('ignores absent and malformed project files', () => {
    expect(projectSettingsText(undefined)).toBe('')
    const root = join(tmpdir(), `dsh-project-settings-${randomUUID()}`)
    roots.push(root)
    mkdirSync(join(root, '.dsh'), { recursive: true })
    writeFileSync(join(root, '.dsh', 'project.yaml'), ': invalid')
    expect(projectSettingsText(root)).toBe('')
  })
})
