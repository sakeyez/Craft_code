import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectAggregateMembershipViolations } from './aggregate-membership.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function addPackage(root: string, path: string, split = false): void {
  const dir = join(root, path)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'package.json'), { name: `@deepseek-ai/dsh-${path.split('/').at(-1)}` })
  if (split) {
    writeJson(join(dir, 'tsconfig.host.json'), {})
    writeJson(join(dir, 'tsconfig.client.json'), {})
    return
  }
  writeJson(join(dir, 'tsconfig.json'), {})
}

function workspaceFixture(options: {
  readonly host: readonly string[]
  readonly client: readonly string[]
}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-aggregate-membership-'))
  roots.push(root)
  addPackage(root, 'packages/core/host-package')
  addPackage(root, 'packages/client/client-package')
  addPackage(root, 'packages/api/split-package', true)
  writeJson(join(root, 'tsconfig.host.json'), {
    references: options.host.map(path => ({ path })),
  })
  writeJson(join(root, 'tsconfig.client.json'), {
    references: options.client.map(path => ({ path })),
  })
  return root
}

describe('root aggregate membership', () => {
  it('accepts one registration per ordinary package and both leaves of a split package', () => {
    const root = workspaceFixture({
      host: ['./packages/core/host-package', './packages/api/split-package/tsconfig.host.json'],
      client: ['./packages/client/client-package', './packages/api/split-package/tsconfig.client.json'],
    })

    expect(collectAggregateMembershipViolations(root)).toEqual([])
  })

  it('rejects an unregistered package', () => {
    const root = workspaceFixture({
      host: ['./packages/api/split-package/tsconfig.host.json'],
      client: ['./packages/client/client-package', './packages/api/split-package/tsconfig.client.json'],
    })

    expect(collectAggregateMembershipViolations(root)).toEqual([
      'packages/core/host-package: TypeScript package must be registered directly in exactly one root aggregate; found none',
    ])
  })

  it('rejects duplicate ordinary registrations and unreachable split leaves', () => {
    const root = workspaceFixture({
      host: ['./packages/core/host-package', './packages/client/client-package'],
      client: ['./packages/core/host-package', './packages/client/client-package'],
    })

    expect(collectAggregateMembershipViolations(root)).toEqual([
      'packages/api/split-package: tsconfig.client.json must be reachable from tsconfig.client.json',
      'packages/api/split-package: tsconfig.host.json must be reachable from tsconfig.host.json',
      'packages/client/client-package: TypeScript package must be registered directly in exactly one root aggregate; found host and client',
      'packages/core/host-package: TypeScript package must be registered directly in exactly one root aggregate; found host and client',
    ])
  })
})
