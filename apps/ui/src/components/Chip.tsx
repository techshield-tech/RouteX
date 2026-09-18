import { useI18n } from '../i18n/context'
import { routeActionKey } from '../i18n/enumKeys'
import type { RouteAction } from '../types'

/** Route identity chip: color alone never carries the meaning, text always does. */
export function RouteChip({ route, suffix }: { route: RouteAction; suffix?: string }) {
  const { t } = useI18n()
  return (
    <span className={`chip chip-${route}`}>
      <span className="chip-dot" aria-hidden="true" />
      {t(routeActionKey[route])}
      {suffix ? (
        <span className="text-muted">&nbsp;{t('enum.route.via', { name: suffix })}</span>
      ) : null}
    </span>
  )
}

/** Neutral labeled chip, used for match type, etc. */
export function Chip({ label }: { label: string }) {
  return <span className="chip chip-neutral">{label}</span>
}
