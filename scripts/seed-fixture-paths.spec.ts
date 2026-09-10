/** JSON string boundaries in recorded session fixture realization. */
import { describe, expect, it } from 'vitest'
import { realizeSeedFixture, type WebScaffold } from '../apps/desktop/renderer/tests/scaffold.ts'

function fixture(cwd: string): string {
  return [
    JSON.stringify({ type: 'session', id: '{{sessionId}}', cwd }),
    JSON.stringify({ type: 'user/message', data: { text: `Workspace: ${cwd}`, token: '{{cwd}}' } }),
    '',
  ].join('\n')
}

function rows(text: string): unknown[] {
  return text.trim().split('\n').map(line => JSON.parse(line) as unknown)
}

describe('realizeSeedFixture', () => {
  it.each(['C:\\Users\\开发者\\mod project', '/tmp/mod "quoted" project'])('preserves the native workspace path %s', (workspaceCwd) => {
    const scaffold = { workspaceCwd } as WebScaffold
    const realized = realizeSeedFixture(scaffold, fixture('{{cwd}}'), 'annotation-session')
    expect(rows(realized)).toEqual([
      { type: 'session', id: 'annotation-session', cwd: workspaceCwd },
      { type: 'user/message', data: { text: `Workspace: ${workspaceCwd}`, token: workspaceCwd } },
    ])
    expect(realizeSeedFixture(scaffold, realized, 'annotation-session')).toBe(realized)
  })

  it('rewrites an escaped recorded cwd in the header and message strings', () => {
    const workspaceCwd = 'D:\\work\\minecraft'
    const realized = realizeSeedFixture({ workspaceCwd } as WebScaffold, fixture('C:\\recorded\\project'), 'annotation-session')
    expect(rows(realized)).toEqual([
      { type: 'session', id: 'annotation-session', cwd: workspaceCwd },
      { type: 'user/message', data: { text: `Workspace: ${workspaceCwd}`, token: workspaceCwd } },
    ])
  })
})
