interface ToggleProps {
  id?: string
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hideLabel?: boolean
  disabled?: boolean
}

/** Accessible switch: role="switch" + aria-checked, with a real (optionally visually-hidden) label. */
export function Toggle({ id, checked, onChange, label, hideLabel, disabled }: ToggleProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
      {hideLabel ? null : <span className="text-13">{label}</span>}
    </span>
  )
}
