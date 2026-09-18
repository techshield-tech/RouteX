import { createContext, useContext } from 'react'
import type { I18nValue } from './types'

export const I18nContext = createContext<I18nValue | null>(null)

/** Active locale, the `t()` translator and the locale-aware value formatters. */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
