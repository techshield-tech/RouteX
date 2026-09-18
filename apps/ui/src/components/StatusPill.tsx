import { useI18n } from '../i18n/context'
import { connectionStatusKey, listenerStatusKey, upstreamHealthKey } from '../i18n/enumKeys'
import type { ConnectionStatus, UpstreamHealth } from '../types'

const healthTone: Record<UpstreamHealth, 'ok' | 'warn' | 'crit'> = {
  healthy: 'ok',
  degraded: 'warn',
  unreachable: 'crit',
}

export function HealthPill({ health }: { health: UpstreamHealth }) {
  const { t } = useI18n()
  return <span className={`pill pill-${healthTone[health]}`}>{t(upstreamHealthKey[health])}</span>
}

const connectionTone: Record<ConnectionStatus, 'ok' | 'neutral' | 'crit'> = {
  active: 'ok',
  closed: 'neutral',
  failed: 'crit',
}

export function ConnectionStatusPill({ status }: { status: ConnectionStatus }) {
  const { t } = useI18n()
  return <span className={`pill pill-${connectionTone[status]}`}>{t(connectionStatusKey[status])}</span>
}

export function ListenerStatusPill({ status }: { status: 'up' | 'down' }) {
  const { t } = useI18n()
  return (
    <span className={`pill ${status === 'up' ? 'pill-ok' : 'pill-crit'}`}>
      {t(listenerStatusKey[status])}
    </span>
  )
}
