import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createFormatters } from '../lib/format'
import { I18nContext } from './context'
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, isLocale, type Locale } from './locales'
import { createTranslator } from './translate'
import type { I18nValue } from './types'

const STORAGE_KEY = 'routex.locale'

function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(raw)) return raw
  } catch {
    // localStorage unavailable (private mode, blocked storage) — fall through.
  }
  return null
}

/** Best match between what the browser asks for and what we actually ship. */
function localeFromNavigator(): Locale | null {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    if (!tag) continue
    const base = tag.toLowerCase().split('-')[0]
    const match = SUPPORTED_LOCALES.find((supported) => supported === base)
    if (match) return match
  }
  return null
}

function detectInitialLocale(): Locale {
  return readStoredLocale() ?? localeFromNavigator() ?? FALLBACK_LOCALE
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    document.documentElement.lang = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore write failures — the choice still applies for this session.
    }
  }, [])

  const value = useMemo<I18nValue>(() => {
    const t = createTranslator(locale)
    return { locale, setLocale, t, fmt: createFormatters(locale, t) }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
