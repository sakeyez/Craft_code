/** Project workbench presentation; effects bind view-only editor messages and scroll position. */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DependencyRole, DependencySource } from '@deepseek-ai/dsh-mc-workbench/types'
import type { WorkbenchInjected } from './index.ts'
import { terminal, type Document, type WorkbenchState } from './model.ts'
import css from './Workbench.module.css'
const ResourcePreview = lazy(() => import('./ResourcePreview.tsx'))

type NavigationProps = PropsRuntime<'workbench.nav'> & InjectFace<WorkbenchInjected>
type PanelProps = PropsRuntime<'workbench.panel'> & InjectFace<WorkbenchInjected>
type FeatureProps = InjectFace<WorkbenchInjected> & { state: WorkbenchState }
const pages = [
  ['code', '代码'],
  ['dependencies', '前置与联动'],
  ['test', '游戏测试'],
] as const
const phaseLabels: Record<string, string> = {
  preparing: '准备环境',
  validating: '校验资源',
  building: '构建中',
  starting: '启动中',
  running: '运行中',
  ready: '游戏就绪',
  stopping: '停止中',
  exited: '已结束',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  disconnected: '连接已断开',
}

export function WorkbenchNavigation(props: NavigationProps) {
  const state = props.useWorkbench(value => value)
  useEffect(() => {
    props.activate(props.cwd)
  }, [props.cwd])
  const active = state.cwd === props.cwd ? state.runs.find(run => !terminal(run)) : undefined
  return (
    <nav className={css.navigation} aria-label="项目工作台">
      <div role="tablist">
        {pages.map(([view, label]) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={props.view === view}
            onClick={() => {
              props.navigate(props.cwd, view)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={css.runStatus}>
        {active && <span>{phaseLabels[active.phase]}</span>}
      </div>
    </nav>
  )
}

export function WorkbenchPanel(props: PanelProps) {
  const state = props.useWorkbench(value => value)
  if (state.cwd !== props.cwd) return <p>正在打开项目…</p>
  return (
    <section className={css.workbench} aria-label="项目工具">
      {state.error && (
        <div className={css.error} role="alert">
          {state.error}
        </div>
      )}
      <div hidden={props.view !== 'test'} className={css.page}>
        <TestWorkspace {...props} state={state} />
      </div>
      <div hidden={props.view !== 'dependencies'} className={css.page}>
        <DependencyWorkspace {...props} state={state} />
      </div>
      <div hidden={props.view !== 'code'} className={css.page}>
        <CodeWorkspace {...props} state={state} />
      </div>
    </section>
  )
}

function TestWorkspace(props: FeatureProps) {
  const { state } = props
  const [query, setQuery] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [follow, setFollow] = useState(true)
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'development' | 'artifact'>('development')
  const [offline, setOffline] = useState(false)
  const [dependencies, setDependencies] = useState<'required' | 'selected'>('selected')
  const log = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [state.log, follow])
  const facts = state.data?.facts
  const active = state.runs.find(run => !terminal(run))
  const selected = state.runs.find(run => run.id === state.runId)
  const supported = facts?.supported
  const visible = state.log
    .split('\n')
    .filter(
      line =>
        (!query || line.toLowerCase().includes(query.toLowerCase())) &&
        (!errorsOnly || /error|exception|failed|失败|错误/i.test(line)),
    )
    .join('\n')
  const action = async (task: () => Promise<unknown>): Promise<void> => {
    try {
      await task()
      setNotice('')
    } catch (error) {
      setNotice(String(error))
    }
  }
  const version = facts?.project.minecraftVersion
  return (
    <>
      <header className={css.heading}>
        <div>
          <h2>游戏测试</h2>
        </div>
        <button onClick={() => void props.refresh()} disabled={state.busy}>
          刷新状态
        </button>
      </header>
      <dl className={css.facts}>
        <div>
          <dt>Minecraft</dt>
          <dd>{version?.status === 'determined' ? version.value : '待检测'}</dd>
        </div>
        <div>
          <dt>加载器</dt>
          <dd>{facts?.project.loader ?? '待检测'}</dd>
        </div>
        <div>
          <dt>Java</dt>
          <dd>
            {facts?.java.major ?? '—'} ·{' '}
            {facts?.java.available ? (facts.java.managed ? '应用托管' : '本机可用') : '待准备'}
          </dd>
        </div>
        <div>
          <dt>Gradle</dt>
          <dd>{facts?.gradleVersion ?? '项目 Wrapper'}</dd>
        </div>
      </dl>
      {facts?.reason && <p className={css.error}>{facts.reason}</p>}
      <div className={css.toolbar}>
        <select aria-label="测试模式" value={mode} disabled={!!active} onChange={(event) =>{  setMode(event.target.value === 'artifact' ? 'artifact' : 'development') }}>
          <option value="development">开发</option><option value="artifact">成品</option>
        </select>
        {mode === 'artifact' && <select aria-label="测试依赖组合" value={dependencies} disabled={!!active} onChange={(event) =>{  setDependencies(event.target.value === 'required' ? 'required' : 'selected') }}>
          <option value="required">仅必需依赖</option><option value="selected">当前选择</option>
        </select>}
        {mode === 'development' && <label title="使用 Gradle 缓存；不会断开系统网络">
          <input type="checkbox" checked={offline} disabled={!!active} onChange={(event) => { setOffline(event.target.checked) }} />离线
        </label>}
        <button
          disabled={!!active || state.busy || !supported}
          onClick={() => void props.start('prepare', { mode, dependencies, offline: mode === 'development' && offline })}
        >
          一键准备环境
        </button>
        <button
          disabled={!!active || state.busy || !supported}
          onClick={() => void props.start('build', { mode, dependencies, offline: mode === 'development' && offline })}
        >
          构建
        </button>
        <button
          className={css.primary}
          disabled={!!active || state.busy || !supported}
          onClick={() => void props.start('client', { mode, dependencies, offline: mode === 'development' && offline })}
        >
          启动客户端
        </button>
        <button
          disabled={!!active || state.busy || !supported}
          onClick={() => void props.start('server', { mode, dependencies, offline: mode === 'development' && offline })}
        >
          启动服务端
        </button>
        <button disabled={!active || active.phase === 'stopping'} onClick={() => void props.stop()}>
          停止
        </button>
        <button onClick={() => log.current?.focus()}>查看日志</button>
      </div>
      <div className={css.status} role="status">
        {active
          ? active.message
          : (selected?.message ?? '')}
        {!active && selected && (selected.failure?.retryable || ['cancelled', 'interrupted'].includes(selected.phase)) &&
          <button disabled={state.busy} onClick={() => void props.retry(selected.id)}>重试</button>}
      </div>
      {active?.steps?.at(-1)?.received !== undefined && <progress
        aria-label="下载进度" value={active.steps.at(-1)?.total ? active.steps.at(-1)?.received : undefined}
        max={active.steps.at(-1)?.total ?? 1} />}
      {(facts?.javaRoles || selected?.steps?.length) && <details>
        <summary>任务详情</summary>
        {facts?.javaRoles && <dl>
          {(['gradle', 'compiler', 'game'] as const).map(role => <div key={role}>
            <dt>{({ gradle: 'Gradle JVM', compiler: '编译 toolchain', game: '游戏 JVM' })[role]}</dt>
            <dd>JDK {facts.javaRoles?.[role].major} · {facts.javaRoles?.basis[role]}</dd>
          </div>)}
        </dl>}
        {selected?.steps?.map((step, index) => <div key={`${step.at}-${index}`}>{step.message}</div>)}
      </details>}
      {selected?.eulaPath && (
        <div className={css.warning}>
          <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">
            阅读 Minecraft EULA
          </a>
          <button
            onClick={() => {
              if (
                selected.eulaPath &&
                window.confirm('是否接受 Minecraft EULA？接受后请重新点击启动服务端。')
              )
                void props.eula(selected.eulaPath)
            }}
          >
            接受 EULA
          </button>
        </div>
      )}
      <details className={css.modSummary}>
        <summary>
          测试模组 ·{' '}
          {state.data?.dependencies.dependencies.filter(dep => dep.role !== 'optional' || dep.enabled)
            .length ?? 0}
        </summary>
        {state.data?.dependencies.dependencies.map(dep => (
          <div key={dep.id}>
            {dep.name} {dep.version} ·{' '}
            {dep.role === 'test' ? '仅测试' : dep.role === 'optional' ? '可选联动' : '必须安装'}
          </div>
        ))}
      </details>
      <div className={css.toolbar}>
        <select
          aria-label="运行记录"
          value={state.runId ?? ''}
          onChange={(event) => {
            props.selectRun(event.target.value)
          }}
        >
          <option value="" disabled>
            选择运行记录
          </option>
          {state.runs.map(run => (
            <option key={run.id} value={run.id}>
              {run.startedAt.slice(0, 19).replace('T', ' ')} · {run.action} · {phaseLabels[run.phase]}
            </option>
          ))}
        </select>
        <input
          aria-label="搜索日志"
          placeholder="搜索日志"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(event) => {
              setErrorsOnly(event.target.checked)
            }}
          />
          只看错误
        </label>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => {
              setFollow(event.target.checked)
            }}
          />
          跟随输出
        </label>
      </div>
      <pre ref={log} tabIndex={0} className={css.log} aria-label="运行日志">
        {visible || '运行日志将在这里显示。'}
      </pre>
      <div className={css.toolbar}>
        <button onClick={() => void action(() => navigator.clipboard.writeText(visible))}>
          复制当前日志
        </button>
        <button
          disabled={!selected}
          onClick={() =>
            void action(async () => {
              downloadText(await props.exportLogs(), 'minecraft-run.log')
            })
          }
        >
          导出完整日志
        </button>
        <button
          disabled={!selected}
          onClick={() => selected && void action(() => props.openPath(`${state.cwd}/${selected.logPath}`))}
        >
          打开原始日志
        </button>
        <button
          disabled={!visible}
          onClick={() =>
            void action(() =>
              props.ask(`请分析当前项目的运行日志，先确认版本与加载器再处理。\n\n${visible.slice(-16000)}`),
            )
          }
        >
          让助手分析日志
        </button>
      </div>
      {notice && <p role="alert">{notice}</p>}
    </>
  )
}

function DependencyWorkspace(props: FeatureProps) {
  const { state } = props
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [role, setRole] = useState<DependencyRole>('required')
  const [kind, setKind] = useState<'modrinth' | 'curseforge' | 'maven' | 'local'>('modrinth')
  const [key, setKey] = useState('')
  const [coordinate, setCoordinate] = useState('')
  const [repository, setRepository] = useState('https://repo.maven.apache.org/maven2')
  const [local, setLocal] = useState('')
  const [notice, setNotice] = useState('')
  const source: DependencySource =
    kind === 'modrinth'
      ? { kind, projectId, versionId }
      : kind === 'curseforge' ? { kind, projectId: Number(projectId), fileId: Number(versionId) }
        : kind === 'maven'
          ? { kind, repository, coordinate }
          : { kind, path: local }
  return (
    <>
      <header className={css.heading}>
        <div>
          <h2>前置与联动</h2>
        </div>
      </header>
      <div className={css.dependencyList}>
        {state.data?.dependencies.dependencies.map(dep => (
          <article key={dep.id} className={css.dependency}>
            <div>
              <strong>{dep.name}</strong>
              <p>
                {dep.version} · {dep.automatic ? '自动前置' : dep.source.kind} ·{' '}
                {dep.compatibility === 'verified' ? '发布版本兼容' : '兼容性待验证'}
              </p>
            </div>
            {!dep.automatic && (
              <select
                aria-label={`${dep.name} 的关系`}
                value={dep.role}
                disabled={state.busy}
                onChange={event =>
                  void props.preview({ updateId: dep.id, role: event.target.value as DependencyRole })
                }
              >
                <option value="required">必须安装</option>
                <option value="optional">可选联动</option>
                <option value="test">仅测试</option>
              </select>
            )}
            {dep.role === 'optional' && (
              <label>
                <input
                  type="checkbox"
                  checked={dep.enabled}
                  disabled={state.busy}
                  onChange={event =>
                    void props.preview({ updateId: dep.id, enabled: event.target.checked })
                  }
                />
                测试时安装
              </label>
            )}
            <button disabled={state.busy} onClick={() => void props.source(dep.id)}>
              查看源码
            </button>
            <button
              onClick={() => {
                const archive = window.prompt('输入与该版本匹配的源码 ZIP/JAR 绝对路径')
                if (archive) void props.source(dep.id, archive)
              }}
            >
              关联源码
            </button>
            <button
              onClick={() =>
                void props
                  .ask(
                    `请为当前模组编写与 ${dep.name} ${dep.version} 的${dep.role === 'optional' ? '可选' : ''}联动。先调用 detect_mc_project，读取真实依赖 API。${dep.role === 'optional' ? '未安装目标模组时也必须能启动。' : ''}\n依赖：${JSON.stringify(dep)}`,
                  )
                  .catch((error: unknown) => {
                    setNotice(String(error))
                  })
              }
            >
              让助手编写联动
            </button>
            {!dep.automatic && (
              <button disabled={state.busy} onClick={() => void props.preview({ removeId: dep.id })}>
                移除
              </button>
            )}
          </article>
        )) ?? null}
        {state.data?.dependencies.dependencies.length === 0 && (
          <p className={css.empty}>添加目标模组，选择必需前置、可选联动或仅用于测试。</p>
        )}
      </div>
      <div className={css.toolbar}>
        <select
          aria-label="依赖来源"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as typeof kind)
            setProjectId(''); setVersionId('')
          }}
        >
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
          <option value="maven">Maven</option>
          <option value="local">本地 JAR</option>
        </select>
        <select
          aria-label="依赖关系"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as DependencyRole)
          }}
        >
          <option value="required">必须安装</option>
          <option value="optional">可选联动</option>
          <option value="test">仅测试</option>
        </select>
      </div>
      {kind === 'curseforge' && state.error?.includes('密钥') && <form onSubmit={(event) => {
        event.preventDefault(); void props.saveCurseForgeKey(key).then(() => { setKey(''); void props.searchMods(query, 'curseforge') }, (error: unknown) =>{  setNotice(String(error)) })
      }}><input type="password" autoComplete="off" aria-label="CurseForge API 密钥" value={key} onChange={(event) =>{  setKey(event.target.value) }} /><button>保存密钥</button></form>}
      {(kind === 'modrinth' || kind === 'curseforge') && (
        <>
          <form
            className={css.toolbar}
            onSubmit={(event) => {
              event.preventDefault()
              setVersionId('')
              void props.searchMods(query, kind)
            }}
          >
            <input
              aria-label="搜索模组"
              placeholder="按项目版本搜索模组"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
            />
            <button disabled={state.busy}>搜索</button>
          </form>
          <div className={css.searchResults}>
            {state.mods.map(mod => (
              <button
                key={mod.id}
                className={projectId === mod.id ? css.selected : ''}
                onClick={() => {
                  setProjectId(mod.id)
                  setVersionId('')
                  void props.modVersions(mod.id, kind)
                }}
              >
                <strong>{mod.name}</strong>
                <span>{mod.description}</span>
              </button>
            ))}
          </div>
          <select
            aria-label="模组版本"
            value={versionId}
            onChange={(event) => {
              setVersionId(event.target.value)
            }}
          >
            <option value="">选择兼容版本</option>
            {state.versions.map(version => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </>
      )}
      {kind === 'maven' && (
        <div className={css.toolbar}>
          <input
            aria-label="Maven 仓库"
            value={repository}
            onChange={(event) => {
              setRepository(event.target.value)
            }}
          />
          <input
            aria-label="Maven 坐标"
            placeholder="group:artifact:version"
            value={coordinate}
            onChange={(event) => {
              setCoordinate(event.target.value)
            }}
          />
        </div>
      )}
      {kind === 'local' && (
        <input
          aria-label="本地 JAR 路径"
          placeholder="本地 JAR 的绝对路径"
          value={local}
          onChange={(event) => {
            setLocal(event.target.value)
          }}
        />
      )}
      <div className={css.toolbar}>
        <button
          className={css.primary}
          disabled={
            state.busy ||
            ((kind === 'modrinth' || kind === 'curseforge') && !versionId) ||
            (kind === 'maven' && !coordinate) ||
            (kind === 'local' && !local)
          }
          onClick={() => void props.preview({ source, role })}
        >
          {state.busy ? '正在处理…' : '预览加入项目'}
        </button>
      </div>
      {state.source && (
        <div className={css.status}>
          {state.source.provenance}
          <p>
            {state.source.status === 'running'
              ? '正在准备源码…'
              : state.source.status === 'ready'
                ? '源码已就绪，请在代码页浏览。'
                : state.source.error}
          </p>
          {state.source.status === 'running' && (
            <button onClick={() => void props.cancelSource()}>取消反编译</button>
          )}
        </div>
      )}
      {state.plan && (
        <section className={css.preview} aria-label="依赖变更预览">
          <h3>确认依赖变更</h3>
          <p>
            {state.plan.dependencies.length} 个依赖 · {state.plan.changes.length} 个文件
          </p>
          <ul>
            {state.plan.dependencies.map(dep => (
              <li key={dep.id}>
                {dep.name} {dep.version} · {dep.automatic ? '自动前置' : '直接依赖'} · {dep.source.kind}
              </li>
            ))}
          </ul>
          {state.plan.warnings.map((warning, i) => (
            <p key={i} className={css.warning}>
              {warning}
            </p>
          ))}
          {state.plan.changes.map(change => (
            <details key={change.path}>
              <summary>{change.path}</summary>
              <div className={css.diffColumns}>
                <pre>{change.before ?? '新文件'}</pre>
                <pre>{change.after}</pre>
              </div>
            </details>
          ))}
          <div className={css.toolbar}>
            <button disabled={state.busy} onClick={() => void props.applyPlan()}>
              应用变更
            </button>
            <button onClick={props.dismissPlan}>取消</button>
          </div>
        </section>
      )}
      {notice && <p role="alert">{notice}</p>}
    </>
  )
}

function CodeWorkspace(props: FeatureProps) {
  const { state } = props
  const [query, setQuery] = useState('')
  const [api, setApi] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState({ key: '', text: '', start: 1, end: 1 })
  const [notice, setNotice] = useState('')
  const document = state.documents.find(doc => doc.key === state.documentKey)
  const ask = (action: string): void => {
    if (!document) return
    const selected =
      selection.key === document.key && selection.text
        ? selection
        : { text: document.draft.slice(0, 16000), start: 1, end: document.draft.split('\n').length }
    void props
      .ask(
        `请${action}以下代码。\n文件：${document.path}:${selected.start}-${selected.end}\n${document.readonly ? `只读依赖源码；${document.provenance ?? ''}` : document.draft !== document.text ? '内容包含未保存草稿。' : '内容来自项目磁盘文件。'}\n\n${selected.text.slice(0, 16000)}`,
      )
      .catch((error: unknown) => {
        setNotice(String(error))
      })
  }
  return (
    <>
      <div className={css.toolbar}>
        <button onClick={() => void props.directory('')}>项目文件</button>
        {state.source?.status === 'ready' && (
          <button onClick={() => state.source && void props.directory('', state.source.id)}>
            依赖源码（只读）
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (api) void props.queryApi(query)
            else void props.search(query)
          }}
        >
          <input
            aria-label={api ? '查询 API 类名' : '搜索项目文本'}
            placeholder={api ? '完整类名' : '搜索项目文本'}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <button>搜索</button>
          <label><input type="checkbox" checked={api} onChange={(event) =>{  setApi(event.target.checked) }} />API</label>
        </form>
      </div>
      {api && state.api && <details open><summary>{state.api.symbol} · {state.api.verified ? '已验证' : '未验证'}</summary>
        <small>{state.api.version} · {state.api.namespace} · {state.api.source}{state.api.cached ? ' · 缓存' : ''}</small><pre>{state.api.text}</pre>
      </details>}
      <div className={css.editorGrid}>
        <aside className={css.fileTree}>
          <input
            aria-label="筛选文件"
            placeholder="筛选当前目录"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
            }}
          />
          <button
            onClick={() =>
              void props.directory(state.directory.split('/').slice(0, -1).join('/'), state.sourceId)
            }
          >
            ↑ {state.directory || '项目根目录'}
          </button>
          {state.entries
            .filter(entry => entry.name.toLowerCase().includes(filter.toLowerCase()))
            .map(entry => (
              <div key={entry.path} className={css.fileRow}>
                <button
                  key={entry.path}
                  title={entry.path}
                  onClick={() =>
                    entry.directory
                      ? void props.directory(entry.path, state.sourceId)
                      : void props.openFile(entry.path)
                  }
                >
                  {entry.directory ? '▸ ' : '  '}
                  {entry.name}
                </button>
                {!entry.directory && !state.sourceId && (
                  <button
                    title="用系统应用打开"
                    aria-label={`用系统应用打开 ${entry.name}`}
                    onClick={() => void props.openPath(`${state.cwd}/${entry.path}`)}
                  >
                    ↗
                  </button>
                )}
              </div>
            ))}
          {state.hits.length > 0 && (
            <div className={css.hits}>
              <strong>搜索结果</strong>
              {state.hits.map((hit, i) => (
                <button key={i} onClick={() => void props.openFile(hit.path, hit.line)} title={hit.text}>
                  {hit.path}:{hit.line}
                  <small>{hit.text}</small>
                </button>
              ))}
            </div>
          )}
        </aside>
        <section className={css.editorColumn}>
          <div className={css.documentTabs}>
            {state.documents.map(doc => (
              <div key={doc.key} className={css.documentTab}>
                <button
                  aria-pressed={doc.key === state.documentKey}
                  onClick={() => {
                    props.selectDocument(doc.key)
                  }}
                >
                  {doc.readonly ? '🔒 ' : ''}
                  {doc.path.split('/').pop()}
                  {doc.draft !== doc.text ? ' ●' : ''}
                </button>
                <button
                  aria-label={`关闭 ${doc.path}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (doc.draft === doc.text || window.confirm('放弃此文件的未保存修改？'))
                      props.closeDocument(doc.key)
                  }}
                >
                  {' '}
                  ×
                </button>
              </div>
            ))}
          </div>
          {document ? (
            <>
              <div className={css.toolbar}>
                <button disabled={document.readonly || state.busy} onClick={() => void props.save()}>
                  保存
                </button>
                <button disabled={document.readonly} onClick={() => void props.diff('disk')}>
                  与磁盘比较
                </button>
                <button disabled={document.readonly} onClick={() => void props.diff('head')}>
                  与 HEAD 比较
                </button>
                <button onClick={() => { setShowPreview(false); void props.diff('off') }}>编辑视图</button>
                {!document.sourceId && /\.(?:json|png)$/u.test(document.path) && (
                  <button onClick={() => { setShowPreview(true); void props.previewResource() }}>预览</button>
                )}
                <button
                  disabled={document.readonly}
                  onClick={() => {
                    if (
                      document.draft === document.text ||
                      window.confirm('重新载入磁盘版本并放弃当前草稿？')
                    )
                      void props.reloadDocument()
                  }}
                >
                  重新载入
                </button>
                <button
                  onClick={() => {
                    ask('解释')
                  }}
                >
                  解释
                </button>
                <button
                  onClick={() => {
                    ask('修改')
                  }}
                >
                  修改
                </button>
                <button
                  onClick={() => {
                    ask('排错')
                  }}
                >
                  排错
                </button>
              </div>
              {(showPreview || document.path.endsWith('.png')) && document.preview ? <Suspense fallback={<span>加载预览…</span>}><ResourcePreview value={document.preview} open={props.openFile} /></Suspense> : <MonacoDocument
                document={document}
                onChange={props.edit}
                onSave={props.save}
                onSelection={setSelection}
              />}
            </>
          ) : (
            <div className={css.empty}>从文件树打开代码，或在前置与联动页选择“查看源码”。</div>
          )}
          {notice && <p role="alert">{notice}</p>}
        </section>
      </div>
    </>
  )
}

function MonacoDocument({
  document,
  onChange,
  onSave,
  onSelection,
}: {
  document: Document
  onChange: (key: string, text: string) => void
  onSave: () => Promise<void>
  onSelection: (value: { key: string; text: string; start: number; end: number }) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const latest = useRef({ document, onChange, onSave, onSelection })
  latest.current = { document, onChange, onSave, onSelection }
  const send = (): void => {
    const doc = latest.current.document
    const ext = doc.path.split('.').pop() ?? ''
    const language =
      (
        {
          java: 'java',
          json: 'json',
          toml: 'ini',
          properties: 'ini',
          gradle: 'java',
          kts: 'kotlin',
          md: 'markdown',
          yml: 'yaml',
        } as Record<string, string>
      )[ext] ?? 'plaintext'
    frame.current?.contentWindow?.postMessage(
      {
        type: 'document',
        key: doc.key,
        text: doc.draft,
        revision: doc.revision,
        readonly: doc.readonly,
        original: doc.original,
        language,
        line: doc.line,
        dark: window.document.body.hasAttribute('data-ds-dark-theme'),
      },
      location.origin,
    )
  }
  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin ||
        !event.data ||
        typeof event.data !== 'object'
      )
        return
      const data = event.data as Record<string, unknown>
      if (data.type === 'ready') {
        send()
        return
      }
      if (data.key !== latest.current.document.key) return
      if (data.type === 'change' && typeof data.text === 'string' && !latest.current.document.readonly)
        latest.current.onChange(data.key, data.text)
      if (data.type === 'save') void latest.current.onSave()
      if (
        data.type === 'selection' &&
        typeof data.text === 'string' &&
        typeof data.start === 'number' &&
        typeof data.end === 'number'
      )
        latest.current.onSelection({
          key: data.key,
          text: data.text,
          start: data.start,
          end: data.end,
        })
    }
    window.addEventListener('message', listener)
    return () => {
      window.removeEventListener('message', listener)
    }
  }, [])
  useEffect(send, [document])
  return <iframe ref={frame} className={css.editor} title="代码编辑器" src="/mc-editor/frame.html" />
}

function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
