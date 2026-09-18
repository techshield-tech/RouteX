import { useI18n } from '../i18n/context'
import { SUPPORTED_LOCALES, localeRegistry, type Locale } from '../i18n/locales'
import { Select } from './Select'

/**
 * Language switcher for the rail. Each option is written in its own language,
 * so someone who cannot read the current UI can still find theirs.
 */
export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n()

  return (
    <Select
      id="locale-select"
      label={t('lang.label')}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      {SUPPORTED_LOCALES.map((code) => (
        <option key={code} value={code} lang={code}>
          {localeRegistry[code].nativeName}
        </option>
      ))}
    </Select>
  )
}
