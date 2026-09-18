// Locale-aware display formatting for RouteX values (rates, byte counts,
// durations, timestamps). Digits come from native `Intl`; the surrounding
// unit text and layout come from the message dictionary, so both halves of a
// value like "6 ngày 4 giờ" follow the active locale.

import type { Formatters, Locale, TranslateFn } from '../i18n/types'

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 3_600
const DAY_SECONDS = 86_400
const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

export function createFormatters(locale: Locale, t: TranslateFn): Formatters {
  const integerFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const decimalFormats = new Map<number, Intl.NumberFormat>()
  const clockFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const listFormat = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })

  function decimal(value: number, digits = 1): string {
    let format = decimalFormats.get(digits)
    if (!format) {
      format = new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
      decimalFormats.set(digits, format)
    }
    return format.format(value)
  }

  function bytes(value: number): string {
    if (value < KB) return t('format.bytes.b', { value: integerFormat.format(value) })
    if (value < MB) return t('format.bytes.kb', { value: decimal(value / KB) })
    if (value < GB) return t('format.bytes.mb', { value: decimal(value / MB) })
    return t('format.bytes.gb', { value: decimal(value / GB) })
  }

  function rate(bytesPerSecond: number): string {
    if (bytesPerSecond < KB) return t('format.rate.b', { value: integerFormat.format(bytesPerSecond) })
    if (bytesPerSecond < MB) return t('format.rate.kb', { value: decimal(bytesPerSecond / KB) })
    if (bytesPerSecond < GB) return t('format.rate.mb', { value: decimal(bytesPerSecond / MB) })
    return t('format.rate.gb', { value: decimal(bytesPerSecond / GB) })
  }

  function duration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    if (totalSeconds < MINUTE_SECONDS) {
      return t('format.duration.seconds', { seconds: integerFormat.format(totalSeconds) })
    }
    const minutes = Math.floor(totalSeconds / MINUTE_SECONDS)
    const seconds = totalSeconds % MINUTE_SECONDS
    return t('format.duration.minutes', {
      minutes: integerFormat.format(minutes),
      seconds: String(seconds).padStart(2, '0'),
    })
  }

  function uptime(totalSeconds: number): string {
    const days = Math.floor(totalSeconds / DAY_SECONDS)
    const hours = Math.floor((totalSeconds % DAY_SECONDS) / HOUR_SECONDS)
    const minutes = Math.floor((totalSeconds % HOUR_SECONDS) / MINUTE_SECONDS)
    if (days > 0) return t('format.uptime.days', { days, hours })
    if (hours > 0) return t('format.uptime.hours', { hours, minutes })
    return t('format.uptime.minutes', { minutes })
  }

  function since(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 1) return t('format.justNow')
    if (minutes < 60) return relativeFormat.format(-minutes, 'minute')
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return relativeFormat.format(-hours, 'hour')
    return relativeFormat.format(-Math.floor(hours / 24), 'day')
  }

  return {
    number: (value) => integerFormat.format(value),
    decimal,
    bytes,
    rate,
    milliseconds: (ms) => t('format.ms', { value: integerFormat.format(ms) }),
    clockTime: (iso) => clockFormat.format(new Date(iso)),
    duration,
    uptime,
    since,
    list: (items) => listFormat.format(items),
  }
}
