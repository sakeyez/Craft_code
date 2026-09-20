/** Project menu dialogs use the workbench model and never create a conversation turn. */
import { useEffect, useRef } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjected } from './index.ts'
import css from './Workbench.module.css'

export function WorkbenchDialogs(props: InjectFace<WorkbenchInjected>) {
  const state = props.useWorkbench(value => value)
  const ref = useRef<HTMLDialogElement>(null)
  const title = state.dialog === 'about' ? '关于 CraftCode' : '恢复点'
  useEffect(() => {
    if (state.dialog) ref.current?.showModal()
    else ref.current?.close()
  }, [state.dialog])
  return (
    <dialog
      ref={ref}
      className={css.dialog}
      onCancel={props.closeDialog}
      aria-label={title}
    >
      <header className={css.heading}>
        <h2>{title}</h2>
        <button onClick={props.closeDialog} aria-label="关闭对话框" title="关闭">
          ×
        </button>
      </header>
      {state.dialog === 'about' ? (
        <>
          <p>CraftCode · AGPL-3.0-only</p>
          <p>
            <a href="https://github.com/sakeyez/Craft_code/blob/master/LICENSE" target="_blank" rel="noreferrer">
              许可证
            </a>{' '}
            ·{' '}
            <a
              href="https://github.com/sakeyez/Craft_code/blob/master/THIRD_PARTY_NOTICES.md"
              target="_blank"
              rel="noreferrer"
            >
              第三方声明
            </a>{' '}
            ·{' '}
            <a href="https://github.com/sakeyez/Craft_code" target="_blank" rel="noreferrer">
              对应源码
            </a>
          </p>
          <p>用户模组的许可证由项目作者选择。</p>
        </>
      ) : (
        <>
          {state.error && <p role="alert">{state.error}</p>}
          <button disabled={state.busy || !state.cwd} onClick={() => void props.checkpoint('create')}>
            创建恢复点
          </button>
          {state.checkpoints?.map(row => (
            <div key={row.id} className={css.toolbar}>
              <span>
                {row.createdAt.slice(0, 19).replace('T', ' ')} · {row.label}
              </span>
              <button disabled={state.busy} onClick={() => void props.checkpoint('preview', row.id)}>
                查看差异
              </button>
              <button
                disabled={state.busy}
                onClick={() => {
                  if (window.confirm('删除此恢复点？')) void props.checkpoint('delete', row.id)
                }}
              >
                删除
              </button>
            </div>
          ))}
          {state.restore && (
            <section aria-label="恢复差异">
              <ul>
                {state.restore.changes.map(row => (
                  <li key={row.path}>
                    <details>
                      <summary>
                        {row.after === null ? '删除' : row.before === null ? '新增' : '修改'} · {row.path}
                      </summary>
                      {row.beforeText !== undefined ? (
                        <>
                          <pre aria-label="当前内容">{row.beforeText}</pre>
                          <pre aria-label="恢复后内容">{row.afterText}</pre>
                        </>
                      ) : (
                        <code>
                          {row.before ?? '∅'} → {row.after ?? '∅'}
                        </code>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
              <button disabled={state.busy} onClick={() => { if (state.restore) void props.checkpoint('restore', state.restore.id) }}>
                保存当前状态并恢复
              </button>
            </section>
          )}
        </>
      )}
    </dialog>
  )
}
