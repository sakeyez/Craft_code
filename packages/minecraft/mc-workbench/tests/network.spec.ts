import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  MinecraftNetwork,
  networkJavaEnvironment,
  NetworkOperation,
  NetworkSettingsSchema,
  minecraftDownloadSources,
  isMinecraftNetworkFailure,
} from '../src/network.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})
const official = 'https://meta.fabricmc.net/v2/versions/game'
const mirror = minecraftDownloadSources(official)[0]

describe('Minecraft network routes', () => {
  it('retains the startup preference across an asynchronous settings change', async () => {
    let value = { mode: 'direct', proxyUrl: '' }
    const settings = {
      get: () => value,
      update: (_namespace: string, next: typeof value) => {
        value = next
        return Promise.resolve()
      },
    }
    const ctx = {
      get: (key: string) => (key === 'settings' ? settings : undefined),
      inject: () => {},
      effect: () => {},
    } as unknown as Context
    const network = new MinecraftNetwork(ctx)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = network.run(async () => {
      await gate
      return networkJavaEnvironment()
    })
    await network.save({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:7890' })
    release()
    expect((await pending).JAVA_TOOL_OPTIONS).not.toContain('7890')
    expect((await network.run(() => networkJavaEnvironment())).JAVA_TOOL_OPTIONS).toContain('7890')
  })
  it('uses only explicitly mapped mirrors', () => {
    expect(mirror).toBe('https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/game')
    expect(minecraftDownloadSources('https://private.example/repository/libraries.minecraft.net/a')).toEqual([
      'https://private.example/repository/libraries.minecraft.net/a',
    ])
  })

  it('prefers a direct mirror even when an inherited proxy is invalid', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('[]'))
    vi.stubGlobal('fetch', fetcher)
    await new NetworkOperation({ mode: 'auto', proxyUrl: '' }, 'socks5://localhost:1080').fetch(official)
    expect(fetcher.mock.calls[0]?.[0]).toBe(mirror)
  })

  it('limits each route to three attempts then remembers the successful fallback', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url === mirror ? new Response('', { status: 503 }) : new Response('[]'),
    )
    vi.stubGlobal('fetch', fetcher)
    const operation = new NetworkOperation({ mode: 'direct', proxyUrl: '' })
    await operation.fetch(official)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([mirror, mirror, mirror, official])
    await operation.fetch(official)
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(official)
  })

  it('rejects a mirror hash mismatch and validates the official payload', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(url === mirror ? 'invalid' : 'valid'))
    vi.stubGlobal('fetch', fetcher)
    const sha = createHash('sha256').update('valid').digest('hex')
    const response = await new NetworkOperation({ mode: 'auto', proxyUrl: '' }).fetch(official, {}, 100, sha)
    expect(await response.text()).toBe('valid')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('never adds a direct fallback in custom proxy mode', async () => {
    const dispatchers: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: { dispatcher: unknown }) => {
        dispatchers.push(options.dispatcher)
        return new Response('', { status: 404 })
      }),
    )
    await expect(
      new NetworkOperation({ mode: 'proxy', proxyUrl: 'http://localhost:7890' }).fetch(official),
    ).rejects.toThrow('代理 HTTP 404')
    expect(dispatchers).toHaveLength(2)
    expect(dispatchers[0]).toBe(dispatchers[1])
  })

  it('cancels without further retries or fallback', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(() => {
      controller.abort(new DOMException('Cancelled', 'AbortError'))
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(
      new NetworkOperation({ mode: 'auto', proxyUrl: '' }).fetch(official, { signal: controller.signal }),
    ).rejects.toThrow('Cancelled')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not include raw transport errors or query secrets in diagnostics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('http://user:password@proxy.invalid secret')
      }),
    )
    const operation = new NetworkOperation({ mode: 'direct', proxyUrl: '' })
    await expect(operation.fetch('https://example.com/file?token=secret')).rejects.toThrow('example.com')
    await expect(operation.fetch('https://example.com/file?token=secret')).rejects.not.toThrow('secret')
  })

  it('validates custom proxy input without echoing credentials', () => {
    for (const proxyUrl of ['socks5://localhost:1080', 'http://user:secret@localhost', 'http://localhost/proxy.pac']) {
      const result = NetworkSettingsSchema.safeParse({ mode: 'proxy', proxyUrl })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.message).not.toContain('secret')
    }
  })

  it('configures the same HTTP proxy for Java and bypasses local addresses', async () => {
    const operation = new NetworkOperation({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:7890' })
    const env = await operation.javaEnvironment(true)
    expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttps.proxyHost=127.0.0.1')
    expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttps.proxyPort=7890')
    expect(env.JAVA_TOOL_OPTIONS).toContain('localhost|127.*|[::1]')
    expect(Object.keys(env)).toEqual(['JAVA_TOOL_OPTIONS'])
  })

  it('ignores inherited proxy in direct mode and reports HTTPS Java incompatibility', async () => {
    const env = await new NetworkOperation({ mode: 'direct', proxyUrl: '' }, 'http://localhost:7890').javaEnvironment()
    expect(env.JAVA_TOOL_OPTIONS).not.toContain('7890')
    await expect(
      new NetworkOperation({ mode: 'proxy', proxyUrl: 'https://localhost:7890' }).javaEnvironment(),
    ).rejects.toThrow('HTTP／混合')
  })

  it('retries transport failures, not compilation, missing coordinates, HTTP 404 or cancellation', () => {
    expect(
      isMinecraftNetworkFailure(
        'MalformedJsonException: Unterminated string at line 1 column 100 path $.versions[2].id',
      ),
    ).toBe(true)
    expect(isMinecraftNetworkFailure('MalformedJsonException: bad project resource')).toBe(false)
    for (const output of ['UnknownHostException', 'Connection reset', 'Received status code 503',
      'javax.net.ssl.SSLHandshakeException: Remote host terminated the handshake', 'SSL peer shut down incorrectly'])
      expect(isMinecraftNetworkFailure(output)).toBe(true)
    for (const output of [
      'Compilation failed',
      'Could not GET resource: HTTP 404',
      'plugin was not found',
      'Build cancelled',
      'Compilation failed\nRemote host terminated the handshake',
      'SSLHandshakeException: no cipher suites in common',
    ])
      expect(isMinecraftNetworkFailure(output)).toBe(false)
  })
})
