import { useEffect, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './Workbench.module.css'

/** Client wire values validated by the host settings schema. */
export interface NetworkPreferences { mode: 'auto' | 'direct' | 'proxy'; proxyUrl: string }
/** Host calls owned by the Minecraft settings entry. */
export interface NetworkSettingsInjected {
  load: () => Promise<NetworkPreferences>
  saveNetwork: (value: NetworkPreferences) => Promise<NetworkPreferences>
  checkNetwork: () => Promise<Array<{ name: string; ok: boolean; message: string }>>
}

/** Network preference editor; requests never enter model context. */
export function NetworkSettings({ load, saveNetwork, checkNetwork }: PropsRuntime<'settings.section'> & InjectFace<NetworkSettingsInjected>) {
  const [value, setValue] = useState<NetworkPreferences>({ mode: 'auto', proxyUrl: '' })
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; message: string }>>([])
  useEffect(() => {
    let active = true
    void load().then((next) => { if (active) setValue(next) }).catch((error: unknown) => { if (active) setMessage(String(error)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [load])
  const save = async (check: boolean): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      setValue(await saveNetwork(value))
      setMessage('设置已保存，将用于下一次下载或构建。')
      if (check) setResults(await checkNetwork())
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className={css.workbench} aria-label="Minecraft 下载与构建">
    <div className={css.page}>
      <h2>Minecraft 下载与构建</h2>
      <p>统一配置版本获取、Java 下载与 Gradle 构建。VPN 使用 TUN 模式时，连接由系统路由处理。</p>
      <label>连接方式 <select aria-label="连接方式" value={value.mode} disabled={busy}
        onChange={(event) => { setValue({ ...value, mode: event.target.value as NetworkPreferences['mode'] }) }}>
        <option value="auto">自动选择（推荐）</option><option value="direct">直连</option><option value="proxy">自定义代理</option>
      </select></label>
      {value.mode === 'auto' && <p>优先国内镜像直连，失败时尝试官方源和系统代理。Java 构建使用检测到的 HTTP 代理。</p>}
      {value.mode === 'proxy' && <label>代理地址 <input aria-label="代理地址" value={value.proxyUrl} disabled={busy}
        placeholder="http://127.0.0.1:7890" onChange={(event) => { setValue({ ...value, proxyUrl: event.target.value }) }} /></label>}
      <p>Java 构建请使用 VPN 的 HTTP／混合端口；不支持 SOCKS、PAC 地址和代理账号密码。</p>
      <div className={css.toolbar}>
        <button disabled={busy} onClick={() => { void save(false) }}>保存网络设置</button>
        <button disabled={busy} onClick={() => { void save(true) }}>{busy ? '请稍候…' : '保存并检测连接'}</button>
      </div>
      {message && <p role="status">{message}</p>}
      {results.map(result => <p key={result.name}>{result.name}：{result.ok ? '✓ ' : '✕ '}{result.message}</p>)}
    </div>
  </section>
}
