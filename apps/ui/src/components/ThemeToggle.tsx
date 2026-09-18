import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { Icon } from './Icon'

type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'routex.theme'

function readStoredTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // localStorage unavailable (private mode, blocked storage) — fall back.
  }
  return 'system'
}

function applyTheme(mode: ThemeMode) {
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }
}

const options: { mode: ThemeMode; labelKey: MessageKey; icon: 'system' | 'sun' | 'moon' }[] = [
  { mode: 'system', labelKey: 'theme.system', icon: 'system' },
  { mode: 'light', labelKey: 'theme.light', icon: 'sun' },
  { mode: 'dark', labelKey: 'theme.dark', icon: 'moon' },
]

export function ThemeToggle() {
  const { t } = useI18n()
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  function choose(next: ThemeMode) {
    setMode(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore write failures — theme still applies for this session.
    }
  }

  return (
    <div
      role="group"
      aria-label={t('theme.group')}
      className="flex gap-1 rounded border border-line bg-surface-2 p-1"
    >
      {options.map((opt) => {
        const label = t(opt.labelKey)
        return (
          <button
            key={opt.mode}
            type="button"
            aria-pressed={mode === opt.mode}
            onClick={() => choose(opt.mode)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-1.5 py-1 text-12 ${
              mode === opt.mode ? 'bg-surface text-text' : 'text-muted'
            }`}
            title={label}
          >
            <Icon name={opt.icon} />
            <span className="sr-only">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
