// The translate function: dictionary lookup + `{placeholder}` interpolation +
// plural selection through `Intl.PluralRules`. No library, no runtime parsing
// beyond a single regex.

import { messagesFor, type Locale } from './locales'
import type { MessageValue, PluralForms, TranslateFn } from './types'

const PLACEHOLDER = /\{(\w+)\}/g

function isPluralForms(value: MessageValue): value is PluralForms {
  return typeof value !== 'string'
}

export function createTranslator(locale: Locale): TranslateFn {
  const messages = messagesFor(locale)
  const pluralRules = new Intl.PluralRules(locale)
  const numberFormat = new Intl.NumberFormat(locale)

  return function t(key, params) {
    const entry: MessageValue | undefined = messages[key]

    if (entry === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] Missing message "${key}" for locale "${locale}".`)
      }
      return key
    }

    let template: string
    if (isPluralForms(entry)) {
      const count = typeof params?.count === 'number' ? params.count : 0
      template = entry[pluralRules.select(count)] ?? entry.other
    } else {
      template = entry
    }

    if (!params) return template

    return template.replace(PLACEHOLDER, (match, name: string) => {
      const value = params[name]
      if (value === undefined) return match
      return typeof value === 'number' ? numberFormat.format(value) : value
    })
  }
}
