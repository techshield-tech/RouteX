import { useEffect, useState } from 'react'
import { fetchMetrics, fetchTrafficSeries } from '../api'
import type { MessageKey } from '../i18n/types'
import type { Metrics, TrafficRange, TrafficSeries } from '../types'
import { useI18n } from '../i18n/context'
import { useConfigStore } from '../state/configContext'
import { PageHeader } from '../components/PageHeader'
import { MetricStrip, type MetricItem } from '../components/MetricStrip'
import { TrafficChart } from '../components/Sparkline'
import { Select } from '../components/Select'
import { ListenerStatusPill, ConnectionStatusPill } from '../components/StatusPill'
import { RouteChip } from '../components/Chip'
import { DataTable } from '../components/DataTable'
import { navigate } from '../lib/router'

const TRAFFIC_RANGE_OPTIONS: { value: TrafficRange; key: MessageKey }[] = [
  { value: '15m', key: 'overview.traffic.range.15m' },
  { value: '1h', key: 'overview.traffic.range.1h' },
  { value: '7d', key: 'overview.traffic.range.7d' },
  { value: '30d', key: 'overview.traffic.range.30d' },
]

export function Overview() {
  const { t, fmt } = useI18n()
  const { listeners } = useConfigStore()
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [range, setRange] = useState<TrafficRange>('15m')
  const [series, setSeries] = useState<TrafficSeries | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMetrics().then((m) => {
      if (!cancelled) setMetrics(m)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The 15m range is already seeded from `metrics.traffic` above, so this
  // effect's fetch only matters (and only shows a gap) for the other ranges.
  useEffect(() => {
    let cancelled = false
    fetchTrafficSeries(range).then((s) => {
      if (!cancelled) setSeries(s)
    })
    return () => {
      cancelled = true
    }
  }, [range])

  if (!metrics) {
    return (
      <div>
        <PageHeader title={t('overview.title')} description={t('overview.description')} />
        <p className="mt-6 text-13 text-muted">{t('common.loading')}</p>
      </div>
    )
  }

  const items: MetricItem[] = [
    { label: t('overview.metric.activeConnections'), value: fmt.number(metrics.activeConnections) },
    { label: t('overview.metric.throughputUp'), value: fmt.rate(metrics.throughputUpBps) },
    { label: t('overview.metric.throughputDown'), value: fmt.rate(metrics.throughputDownBps) },
    {
      label: t('overview.metric.proxiedVsDirect'),
      value: t('format.sharePair', {
        proxied: fmt.number(metrics.proxiedSharePct),
        direct: fmt.number(metrics.directSharePct),
      }),
    },
    {
      label: t('overview.metric.rulesEnabled'),
      value: t('format.ratio', {
        current: fmt.number(metrics.rulesEnabled),
        total: fmt.number(metrics.rulesTotal),
      }),
    },
    { label: t('overview.metric.uptime'), value: fmt.uptime(metrics.uptimeSeconds) },
  ]

  const maxHits = metrics.topRules[0]?.hits ?? 1

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('overview.title')} description={t('overview.description')} />

      <MetricStrip items={items} />

      <section aria-labelledby="traffic-heading" className="rounded border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="traffic-heading" className="text-14 font-medium text-balance">
            {t('overview.traffic.heading')}
          </h2>
          <Select
            id="traffic-range"
            label={t('overview.traffic.range.label')}
            hideLabel
            value={range}
            onChange={(e) => setRange(e.target.value as TrafficRange)}
          >
            {TRAFFIC_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.key)}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3">
          <TrafficChart points={series?.points ?? metrics.traffic} range={range} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 nav:grid-cols-2">
        <section aria-labelledby="listeners-heading" className="rounded border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="listeners-heading" className="text-14 font-medium text-balance">
              {t('overview.listeners.heading')}
            </h2>
            <a
              href="#/listeners"
              className="text-12 text-accent underline underline-offset-2 hover:text-accent-strong"
            >
              {t('overview.listeners.manage')}
            </a>
          </div>
          <div className="mt-3">
            <DataTable>
              <thead>
                <tr>
                  <th scope="col">{t('overview.listeners.col.listener')}</th>
                  <th scope="col">{t('overview.listeners.col.address')}</th>
                  <th scope="col">{t('overview.listeners.col.status')}</th>
                  <th scope="col" className="text-right">
                    {t('overview.listeners.col.connections')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {listeners.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td className="font-mono text-12">
                      {l.bind}:{l.port}
                    </td>
                    <td>
                      <ListenerStatusPill status={l.status} />
                    </td>
                    <td className="text-right font-mono tabular-nums">{fmt.number(l.connections)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        </section>

        <section aria-labelledby="top-rules-heading" className="rounded border border-line bg-surface p-4">
          <h2 id="top-rules-heading" className="text-14 font-medium text-balance">
            {t('overview.topRules.heading')}
          </h2>
          <ul className="mt-3 flex list-none flex-col gap-2.5 p-0">
            {metrics.topRules.map((rule) => (
              <li key={rule.name} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-13">
                  <span className="text-text">{rule.name}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">{fmt.number(rule.hits)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${Math.max(4, (rule.hits / maxHits) * 100)}%`, background: 'var(--rx-accent)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="recent-connections-heading" className="rounded border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-connections-heading" className="text-14 font-medium text-balance">
            {t('overview.recent.heading')}
          </h2>
          <button type="button" className="btn-ghost" onClick={() => navigate('/connections')}>
            {t('overview.recent.viewAll')}
          </button>
        </div>
        <div className="mt-3">
          <DataTable>
            <thead>
              <tr>
                <th scope="col">{t('overview.recent.col.time')}</th>
                <th scope="col">{t('overview.recent.col.target')}</th>
                <th scope="col">{t('overview.recent.col.route')}</th>
                <th scope="col">{t('overview.recent.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recentConnections.map((c) => (
                <tr key={c.id} className={`route-stripe route-stripe-${c.route}`}>
                  <td className="font-mono text-12 tabular-nums">{fmt.clockTime(c.time)}</td>
                  <td className="font-mono text-12">{c.target}</td>
                  <td>
                    <RouteChip route={c.route} />
                  </td>
                  <td>
                    <ConnectionStatusPill status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </section>
    </div>
  )
}
