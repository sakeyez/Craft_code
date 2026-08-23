import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSkillSyncViolations, syncSkills } from './sync-mcmod-skills.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { source: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mcmod-skills-'))
  roots.push(root)
  const source = join(root, 'source')
  const target = join(root, 'target')
  mkdirSync(join(source, 'fabric-mod-dev'), { recursive: true })
  writeFileSync(join(source, 'fabric-mod-dev', 'SKILL.md'), 'source\n')
  return { source, target }
}

describe('Minecraft skill source synchronization', () => {
  it('generates byte-identical target content', () => {
    const { source, target } = fixture()
    syncSkills(source, target)
    expect(collectSkillSyncViolations(source, target)).toEqual([])
  })

  it('reports drift and extra files', () => {
    const { source, target } = fixture()
    syncSkills(source, target)
    writeFileSync(join(target, 'fabric-mod-dev', 'SKILL.md'), 'stale\n')
    mkdirSync(join(target, 'old-skill'))
    writeFileSync(join(target, 'old-skill', 'SKILL.md'), 'old\n')
    expect(collectSkillSyncViolations(source, target)).toEqual([
      'extra generated Minecraft skill file: old-skill/SKILL.md',
      'generated Minecraft skill differs from source: fabric-mod-dev/SKILL.md',
    ])
  })
})
