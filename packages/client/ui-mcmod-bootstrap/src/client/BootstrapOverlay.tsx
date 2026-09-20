import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { OperationStage } from '@deepseek-ai/dsh-tool-mc-bootstrap/src/types'
import type { BootstrapWizardInjected, WizardSnapshot } from './model.ts'
import type { BootstrapKey } from './locales.ts'
import css from './Bootstrap.module.css'

export type BootstrapOverlayProps = InjectFace<BootstrapWizardInjected> & PropsLocale<'mcmodBootstrap'>

/** Frame-wide modal surface for the New Mod action. */
export function BootstrapOverlay({
  useWizard,
  close,
  toggleAdvanced,
  setModName,
  setLoader,
  setEntry,
  setParentDirectory,
  setDirectoryName,
  setModId,
  setPackageName,
  chooseParent,
  start,
  retry,
  cancel,
  refreshCatalog,
  openDirectory,
  t,
}: BootstrapOverlayProps): React.JSX.Element {
  const state = useWizard((snapshot: WizardSnapshot) => snapshot)
  const form = state.form
  const entries = state.catalog?.entries.filter(entry => entry.loader === form.loader) ?? []
  const selectedEntry = entries.find(entry => entry.entryId === form.entryId)
  const javaReady = selectedEntry !== undefined
  const busy = state.submitting || state.status?.status === 'queued' || state.status?.status === 'running'
  const terminal = state.status?.status === 'failed' || state.status?.status === 'cancelled'
  const registrationPending = state.status?.status === 'ready' && state.registrationError !== undefined
  const closeIfIdle = (): void => {
    if (!busy) close()
  }
  const translate = (key: BootstrapKey): string => t(key)
  const stageLabel = (stage: OperationStage): string => translate(`phase.${stage}`)

  return (
    <Modal
      open={state.open}
      onClose={closeIfIdle}
      title={t('dialog.title')}
      closeLabel={t('close')}
      headless
      className={css.modal ?? ''}
    >
      <div className={css.dialogCard}>
        <header className={css.dialogHeader}>
          <div>
            <h2>{t('dialog.title')}</h2>
            <p>{t('dialog.description')}</p>
          </div>
          <button
            type="button"
            className={css.closeButton}
            aria-label={t('close')}
            disabled={busy}
            onClick={closeIfIdle}
          >
            ×
          </button>
        </header>

        <form
          className={css.form}
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          <label>
            <span>{t('field.modName')}</span>
            <Input
              className={css.textField ?? ''}
              autoFocus={!busy}
              value={form.modName}
              placeholder={t('field.modName.placeholder')}
              disabled={busy}
              onChange={(event) => {
                setModName(event.target.value)
              }}
            />
          </label>

          <div className={css.fieldGrid}>
            <label>
              <span>{t('field.loader')}</span>
              <select
                value={form.loader}
                disabled={busy}
                onChange={(event) => {
                  setLoader(event.target.value as 'fabric' | 'neoforge')
                }}
              >
                <option value="fabric">{t('loader.fabric')}</option>
                <option value="neoforge">{t('loader.neoforge')}</option>
              </select>
            </label>
            <label>
              <span>{t('field.version')}</span>
              <select
                value={form.entryId}
                disabled={busy || entries.length === 0}
                onChange={(event) => {
                  setEntry(event.target.value)
                }}
              >
                {entries.length === 0 && <option value="">{state.loadingCatalog ? t('catalog.loading') : t('catalog.empty')}</option>}
                {['1.21', '1.20'].map(line => (
                  <optgroup key={line} label={line + '.x'}>
                    {entries
                      .filter(
                        entry =>
                          entry.minecraftVersion.startsWith(line),
                      )
                      .map(entry => (
                        <option key={entry.entryId} value={entry.entryId}>
                          {entry.minecraftVersion}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {selectedEntry && <small>{selectedEntry.loaderVersion} · JDK {selectedEntry.requiredJdk}</small>}
            </label>
          </div>

          <div className={css.javaLine} role="status">
            {state.loadingCatalog && <span>{t('catalog.loading')}</span>}
            {!state.loadingCatalog &&
              selectedEntry !== undefined &&
              state.catalog?.java.available &&
              state.catalog.java.version === selectedEntry.requiredJdk && (
              <span>{t('java.available', { version: state.catalog.java.version ?? '?' })}</span>
            )}
            {!state.loadingCatalog &&
              selectedEntry !== undefined &&
              state.catalog?.java.available &&
              state.catalog.java.version !== selectedEntry.requiredJdk && (
              <span>{t('java.required', { version: selectedEntry.requiredJdk })}</span>
            )}
            {!state.loadingCatalog && state.catalog !== undefined && !state.catalog.java.available && (
              <span>创建时自动准备所需 JDK，不修改系统 Java。</span>
            )}
            {state.catalog?.cached && (
              <span className={css.cacheBadge}>
                {state.catalog.stale ? t('catalog.stale') : t('catalog.cached')}
              </span>
            )}
          </div>

          <label>
            <span>{t('field.parent')}</span>
            <div className={css.pathRow}>
              <Input
                className={css.textField ?? ''}
                value={form.parentDirectory}
                placeholder={t('field.parent.placeholder')}
                disabled={busy || state.pickingParent}
                onChange={(event) => {
                  setParentDirectory(event.target.value)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || state.pickingParent}
                onClick={() => {
                  void chooseParent()
                }}
              >
                {state.pickingParent ? '…' : t('choose')}
              </Button>
            </div>
          </label>

          <label>
            <span>{t('field.directory')}</span>
            <Input
              className={css.textField ?? ''}
              value={form.directoryName}
              disabled={busy}
              onChange={(event) => {
                setDirectoryName(event.target.value)
              }}
            />
          </label>

          <button
            type="button"
            className={css.advancedToggle}
            aria-expanded={state.advanced}
            onClick={() => {
              toggleAdvanced()
            }}
          >
            <span aria-hidden="true">{state.advanced ? '▾' : '▸'}</span> {t('advanced')}
          </button>
          {state.advanced && (
            <div className={css.advancedFields}>
              <label>
                <span>{t('field.modId')}</span>
                <Input
                  className={css.textField ?? ''}
                  value={form.modId}
                  disabled={busy}
                  onChange={(event) => {
                    setModId(event.target.value)
                  }}
                />
              </label>
              <label>
                <span>{t('field.package')}</span>
                <Input
                  className={css.textField ?? ''}
                  value={form.packageName}
                  disabled={busy}
                  onChange={(event) => {
                    setPackageName(event.target.value)
                  }}
                />
              </label>
            </div>
          )}

          {state.error !== undefined && (
            <div className={css.error} role="alert">
              {state.error}
            </div>
          )}
          {state.registrationError !== undefined && (
            <div className={css.error} role="alert">
              {state.registrationError}
            </div>
          )}

          {!state.loadingCatalog && entries.length === 0 && !busy && state.status === undefined && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refreshCatalog()
              }}
            >
              {t('catalog.retry')}
            </Button>
          )}

          {state.status !== undefined && (
            <section className={css.progressPanel} aria-live="polite">
              <div className={css.progressHeading}>
                <strong>{stageLabel(state.status.stage)}</strong>
                <span>{Math.round(state.status.progress)}%</span>
              </div>
              <progress max={100} value={state.status.progress} />
              <div className={css.statusText}>
                {t(`status.${state.status.status}`)}
                {state.status.message ? ` · ${state.status.message}` : ''}
              </div>
              {state.status.logTail !== '' && <pre className={css.log}>{state.status.logTail}</pre>}
              {state.status.status === 'ready' && state.registrationError === undefined && (
                <p className={css.success}>{t('success')}</p>
              )}
              {state.status.status === 'failed' && <p className={css.error}>{t('failed')}</p>}
              {state.status.status === 'cancelled' && <p className={css.warning}>{t('cancelled')}</p>}
            </section>
          )}

          <footer className={css.footer}>
            {busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void cancel()
                }}
              >
                {t('cancel')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={closeIfIdle}>
                {t('cancel')}
              </Button>
            )}
            {state.status?.projectPath !== undefined && (terminal || registrationPending) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void openDirectory()
                }}
              >
                {t('openDirectory')}
              </Button>
            )}
            {(terminal || registrationPending) && (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  void retry()
                }}
              >
                {registrationPending ? t('registerRetry') : t('retry')}
              </Button>
            )}
            {!terminal && !registrationPending && state.status?.status !== 'ready' && (
              <Button
                type="submit"
                variant="primary"
                disabled={busy || entries.length === 0 || !javaReady}
              >
                {state.submitting ? t('submitting') : t('submit')}
              </Button>
            )}
          </footer>
        </form>
      </div>
    </Modal>
  )
}
