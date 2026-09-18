import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchConnectionsSeed, openConnectionsStream } from '../api'
import { useI18n } from '../i18n/context'
import { routeActionKey } from '../i18n/enumKeys'
import { useConfigStore } from '../state/configContext'
import { PageHeader } from '../components/PageHeader'
import { SearchInput } from '../components/SearchInput'
import { Select } from '../components/Select'
import { DataTable } from '../components/DataTable'
import { RouteChip } from '../components/Chip'
import { ConnectionStatusPill } from '../components/StatusPill'
import { EmptyState } from '../components/EmptyState'
import type { Connection, RouteAction } from '../types'

const MAX_ROWS = 200
const routeOrder: RouteAction[] = ['proxy', 'direct', 'block']

export function Connections() {
  const { t, fmt } = useI18n()
  const { listeners } = useConfigStore()
  const [rows, setRows] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [query, setQuery] = useState('')
  const [routeFilter, setRouteFilter] = useState<'all' | RouteAction>('all')
  const [listenerFilter, setListenerFilter] = useState<'all' | string>('all')
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    let cancelled = false
    fetchConnectionsSeed(40).then((seed) => {
      if (cancelled) return
      setRows(seed)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const source = openConnectionsStream((conn) => {
      if (pausedRef.current) return
      // Each connection fires twice — once when it starts (`active`), again
      // when it closes or fails — so replace any existing row for the same
      // id instead of appending a duplicate, and bring it back to the top.
      setRows((prev) => [conn, ...prev.filter((r) => r.id !== conn.id)].slice(0, MAX_ROWS))
    })
    return () => source?.close()
  }, [])

  const listenerName = (id: string) => listeners.find((l) => l.id === id)?.name ?? id

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (routeFilter !== 'all' && r.route !== routeFilter) return false
      if (listenerFilter !== 'all' && r.listenerId !== listenerFilter) return false
      if (q && !r.target.toLowerCase().includes(q) && !r.client.toLowerCase().includes(q) && !r.matchedRule.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [rows, query, routeFilter, listenerFilter])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('connections.title')} description={t('connections.description')} />

      <div className="flex flex-col gap-3 nav:flex-row nav:items-end nav:flex-wrap">
        <div className="nav:w-64">
          <SearchInput
            id="connections-search"
            label={t('connections.search.label')}
            value={query}
            onChange={setQuery}
            placeholder={t('connections.search.placeholder')}
          />
        </div>
        <Select
          id="connections-route-filter"
          label={t('connections.filter.route')}
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value as typeof routeFilter)}
        >
          <option value="all">{t('connections.filter.route.all')}</option>
          {routeOrder.map((value) => (
            <option key={value} value={value}>
              {t(routeActionKey[value])}
            </option>
          ))}
        </Select>
        <Select
          id="connections-listener-filter"
          label={t('connections.filter.listener')}
          value={listenerFilter}
          onChange={(e) => setListenerFilter(e.target.value)}
        >
          <option value="all">{t('connections.filter.listener.all')}</option>
          {listeners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="btn-secondary"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? t('connections.resume') : t('connections.pause')}
        </button>
      </div>

      {loading ? (
        <p className="text-13 text-muted">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <EmptyState message={t('connections.empty')} />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th scope="col">{t('connections.col.time')}</th>
              <th scope="col">{t('connections.col.listener')}</th>
              <th scope="col">{t('connections.col.client')}</th>
              <th scope="col">{t('connections.col.target')}</th>
              <th scope="col">{t('connections.col.matchedRule')}</th>
              <th scope="col">{t('connections.col.route')}</th>
              <th scope="col" className="text-right">
                {t('connections.col.up')}
              </th>
              <th scope="col" className="text-right">
                {t('connections.col.down')}
              </th>
              <th scope="col" className="text-right">
                {t('connections.col.duration')}
              </th>
              <th scope="col">{t('connections.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className={`route-stripe route-stripe-${c.route}`}>
                <td className="font-mono text-12 tabular-nums">{fmt.clockTime(c.time)}</td>
                <td className="text-13">{listenerName(c.listenerId)}</td>
                <td className="font-mono text-12">{c.client}</td>
                <td className="font-mono text-12">{c.target}</td>
                <td className="text-13">{c.matchedRule}</td>
                <td>
                  <RouteChip route={c.route} />
                </td>
                <td className="text-right font-mono text-12 tabular-nums">{fmt.bytes(c.bytesUp)}</td>
                <td className="text-right font-mono text-12 tabular-nums">{fmt.bytes(c.bytesDown)}</td>
                <td className="text-right font-mono text-12 tabular-nums">{fmt.duration(c.durationMs)}</td>
                <td>
                  <ConnectionStatusPill status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  )
}
