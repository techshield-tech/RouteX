import { useI18n } from '../i18n/context'

interface ConfirmInlineProps {
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Inline yes/no swap used instead of window.confirm(). */
export function ConfirmInline({ message, confirmLabel, onConfirm, onCancel }: ConfirmInlineProps) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-13">
      <span className="text-muted">{message}</span>
      <button type="button" className="btn-secondary" onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button type="button" className="btn-danger" onClick={onConfirm}>
        {confirmLabel ?? t('common.delete')}
      </button>
    </div>
  )
}
