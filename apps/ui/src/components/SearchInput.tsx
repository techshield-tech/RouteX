import { Icon } from './Icon'

interface SearchInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({ id, label, value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? label}
          className="field-control pl-8"
        />
      </div>
    </div>
  )
}
