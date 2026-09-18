// Locale registry. Adding a third language is one new file next to this one
// plus one line in `localeRegistry` — nothing else in the app changes, because
// `Locale`, the switcher options and the fallback chain all derive from here.

import type { LocaleMessages } from '../types'
import { en } from './en'
import { vi } from './vi'

export interface LocaleEntry {
  /** The language's name written in that language — never translated. */
  nativeName: string
  messages: LocaleMessages
}

export const localeRegistry = {
  en: { nativeName: 'English', messages: en },
  vi: { nativeName: 'Tiếng Việt', messages: vi },
} satisfies Record<string, LocaleEntry>

export type Locale = keyof typeof localeRegistry

export const SUPPORTED_LOCALES = Object.keys(localeRegistry) as Locale[]

/** Source locale: used as the fallback when nothing else matches. */
export const FALLBACK_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(localeRegistry, value)
}

export function messagesFor(locale: Locale): LocaleMessages {
  return localeRegistry[locale].messages
}
