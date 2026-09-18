import type { ReactNode } from 'react'

interface EmptyStateProps {
  message: string
  actionLabel?: string
  onAction?: () => void
  icon?: ReactNode
}

/** An invitation to act, not a blank space. */
export function EmptyState({ message, actionLabel, onAction, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded border border-dashed border-line px-6 py-10 text-center">
      {icon}
      <p className="max-w-sm text-13 text-muted">{message}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="btn-primary">
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
