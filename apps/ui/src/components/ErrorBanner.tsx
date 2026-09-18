import { useConfigStore } from '../state/configContext'
import { useI18n } from '../i18n/context'
import { Icon } from './Icon'

/**
 * Surfaces the config store's most recent failed request. Replaces the old
 * mock-data notice (`SampleDataBanner`) now that the console talks to a
 * real server and errors come from real requests instead.
 */
export function ErrorBanner() {
  const { t } = useI18n()
  const { error, dismissError } = useConfigStore()
  if (!error) return null

  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-13"
      style={{ background: 'var(--rx-crit-soft)', color: 'var(--rx-crit)' }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon name="warning" className="shrink-0" />
        <span className="min-w-0 truncate">{error}</span>
      </span>
      <button type="button" className="icon-btn" onClick={dismissError} aria-label={t('error.dismiss')}>
        <Icon name="close" />
      </button>
    </div>
  )
}
