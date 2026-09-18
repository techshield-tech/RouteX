import { useI18n } from '../i18n/context'
import { useConfigStore } from '../state/configContext'

export function PendingChangesBar() {
  const { t } = useI18n()
  const { pendingChanges, applying, applyChanges, discardChanges } = useConfigStore()
  const count = pendingChanges.length
  if (count === 0) return null

  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
      <span className="text-13 text-text">{t('pending.count', { count })}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => void discardChanges()} disabled={applying}>
          {t('pending.discard')}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void applyChanges()}
          disabled={applying}
        >
          {applying ? t('pending.applying') : t('pending.apply')}
        </button>
      </div>
    </div>
  )
}
