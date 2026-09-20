import { useEffect, useRef } from 'react'
import type React from 'react'
import { IconProjectAddOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarPrimaryActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BootstrapWizardInjected } from './model.ts'
import css from './Bootstrap.module.css'

export type BootstrapActionProps = SidebarPrimaryActionOwnerProps
  & InjectFace<BootstrapWizardInjected>
  & PropsLocale<'mcmodBootstrap'>

/** Primary sidebar action. The surrounding shell supplies the wide/rail state. */
export function BootstrapAction({ wide, open: openWizard, useWizard, t }: BootstrapActionProps): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const open = useWizard(state => state.open)
  useEffect(() => {
    if (wasOpen.current && !open) ref.current?.focus()
    wasOpen.current = open
  }, [open])
  const button = (
    <button
      ref={ref}
      type="button"
      className={css.action}
      aria-label={t('action.aria')}
      onClick={() => { openWizard() }}
    >
      <IconProjectAddOutline16 size={wide ? 16 : 18} />
      {wide && <span className={css.actionText}>{t('action.label')}</span>}
      {wide && <span className={css.actionHelper}>{t('action.helper')}</span>}
    </button>
  )
  return wide ? button : <Tooltip label={t('action.aria')} delayMs={500}>{button}</Tooltip>
}
