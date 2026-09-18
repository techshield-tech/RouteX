// Shared i18n types. `en` is the source of truth for the message shape; every
// other locale is checked against it, so a missing or extra key fails `tsc`.

import type { en } from './locales/en'
import type { Locale } from './locales'

/** Plural buckets as named by `Intl.PluralRules`. `other` is always required. */
export interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

export type MessageValue = string | PluralForms

export type Messages = typeof en

export type MessageKey = keyof Messages

/**
 * The shape every locale file must have: same keys as `en`, and the same kind
 * of value (plain string vs. plural object) for each key.
 */
export type LocaleMessages = {
  [K in MessageKey]: Messages[K] extends string ? string : PluralForms
}

/** Values spliced into `{placeholders}`. Numbers are formatted for the locale. */
export type TranslateParams = Record<string, string | number>

export type TranslateFn = (key: MessageKey, params?: TranslateParams) => string

/**
 * Locale-aware value formatters, all built on native `Intl`. Unit and pattern
 * text comes from the message dictionary, so the shape of e.g. an uptime or a
 * byte count is translatable too, not just the digits.
 */
export interface Formatters {
  /** Integer with locale grouping — hit counts, connection counts. */
  number: (value: number) => string
  /** Fixed-fraction decimal — chart axis ticks. */
  decimal: (value: number, digits?: number) => string
  /** Byte count scaled to B / KB / MB / GB. */
  bytes: (bytes: number) => string
  /** Throughput scaled to B/s / KB/s / MB/s / GB/s. */
  rate: (bytesPerSecond: number) => string
  /** Latency in milliseconds. */
  milliseconds: (ms: number) => string
  /** Wall-clock time of an ISO timestamp, 24-hour. */
  clockTime: (iso: string) => string
  /** Elapsed connection duration. */
  duration: (ms: number) => string
  /** Process uptime, coarse (days/hours/minutes). */
  uptime: (totalSeconds: number) => string
  /** "5 minutes ago" for an ISO timestamp in the past. */
  since: (iso: string) => string
  /** Natural-language join of a short list. */
  list: (items: string[]) => string
}

export interface I18nValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: TranslateFn
  fmt: Formatters
}

export type { Locale }
