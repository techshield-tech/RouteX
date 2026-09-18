import { useState } from 'react'
import { useConfigStore } from '../state/configContext'
import { useI18n } from '../i18n/context'
import { routeActionKey } from '../i18n/enumKeys'
import { PageHeader } from '../components/PageHeader'
import { SearchInput } from '../components/SearchInput'
import { Select } from '../components/Select'
import { DataTable } from '../components/DataTable'
import { RouteChip, Chip } from '../components/Chip'
import { Toggle } from '../components/Toggle'
import { Icon } from '../components/Icon'
import { ConfirmInline } from '../components/ConfirmInline'
import { EmptyState } from '../components/EmptyState'
import { RouteEntryFormDrawer, type RouteEntryFormValues } from '../components/RouteEntryFormDrawer'
import { navigate, useRoute } from '../lib/router'
import type { RouteAction, RouteEntry } from '../types'

const actionOrder: RouteAction[] = ['proxy', 'direct', 'block']
const ROUTING_PREFIX = '/routing/'

export function Routing() {
  const { t, fmt } = useI18n()
  const {
    routeEntries,
    ruleTemplates,
    ruleGroups,
    listeners,
    upstreams,
    addRouteEntry,
    updateRouteEntry,
    removeRouteEntry,
    duplicateRouteEntry,
    moveRouteEntry,
    toggleRouteEntryEnabled,
    templateCountForGroup,
  } = useConfigStore()

  const route = useRoute()
  const pathListenerId = route.startsWith(ROUTING_PREFIX) ? route.slice(ROUTING_PREFIX.length) : null
  const initialListenerFilter = pathListenerId && listeners.some((l) => l.id === pathListenerId) ? pathListenerId : 'all'

  const [query, setQuery] = useState('')
  const [listenerFilter, setListenerFilter] = useState<'all' | string>(initialListenerFilter)
  const [actionFilter, setActionFilter] = useState<'all' | RouteAction>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<RouteEntry | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const listenerName = (id: string) => listeners.find((l) => l.id === id)?.name ?? id
  const upstreamName = (id: string | null) => upstreams.find((u) => u.id === id)?.name

  function targetOf(entry: RouteEntry) {
    if (entry.targetKind === 'group') {
      const group = ruleGroups.find((g) => g.id === entry.targetId)
      return { name: group?.name ?? entry.targetId, enabled: group?.enabled ?? true }
    }
    const template = ruleTemplates.find((tpl) => tpl.id === entry.targetId)
    return { name: template?.name ?? entry.targetId, enabled: template?.enabled ?? true, pattern: template?.pattern }
  }

  function matchesFilters(entry: RouteEntry) {
    if (actionFilter !== 'all' && entry.action !== actionFilter) return false
    if (listenerFilter !== 'all' && !entry.listenerIds.includes(listenerFilter)) return false
    const q = query.trim().toLowerCase()
    if (q) {
      const targetName = targetOf(entry).name.toLowerCase()
      if (!entry.name.toLowerCase().includes(q) && !targetName.includes(q)) return false
    }
    return true
  }

  const filtered = routeEntries.filter(matchesFilters)

  function openAdd() {
    setEditingEntry(null)
    setDrawerOpen(true)
  }
  function openEdit(entry: RouteEntry) {
    setEditingEntry(entry)
    setDrawerOpen(true)
  }

  function handleSubmit(values: RouteEntryFormValues) {
    if (editingEntry) {
      updateRouteEntry(editingEntry.id, values, { key: 'change.route.edited', params: { name: values.name } })
    } else {
      addRouteEntry(values)
    }
    setDrawerOpen(false)
  }

  if (listeners.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('routing.title')} description={t('routing.description')} />
        <EmptyState
          message={t('routing.empty.noListeners')}
          actionLabel={t('routing.empty.goToListeners')}
          onAction={() => navigate('/listeners')}
        />
      </div>
    )
  }

  if (ruleTemplates.length === 0 && ruleGroups.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('routing.title')} description={t('routing.description')} />
        <EmptyState
          message={t('routing.empty.noTemplates')}
          actionLabel={t('routing.empty.goToTemplates')}
          onAction={() => navigate('/templates')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('routing.title')}
        description={t('routing.description')}
        action={
          <button type="button" className="btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            {t('routing.add')}
          </button>
        }
      />

      <div className="flex flex-col gap-3 nav:flex-row nav:items-end nav:flex-wrap">
        <div className="nav:w-64">
          <SearchInput
            id="routing-search"
            label={t('routing.search.label')}
            value={query}
            onChange={setQuery}
            placeholder={t('routing.search.placeholder')}
          />
        </div>
        <Select
          id="routing-listener-filter"
          label={t('routing.filter.listener')}
          value={listenerFilter}
          onChange={(e) => setListenerFilter(e.target.value)}
        >
          <option value="all">{t('routing.filter.listener.all')}</option>
          {listeners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select
          id="routing-action-filter"
          label={t('routing.filter.action')}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
        >
          <option value="all">{t('routing.filter.action.all')}</option>
          {actionOrder.map((value) => (
            <option key={value} value={value}>
              {t(routeActionKey[value])}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          message={routeEntries.length === 0 ? t('routing.empty.none') : t('routing.empty.filtered')}
          actionLabel={routeEntries.length === 0 ? t('routing.add') : undefined}
          onAction={routeEntries.length === 0 ? openAdd : undefined}
        />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th scope="col">{t('routing.col.priority')}</th>
              <th scope="col">{t('routing.col.name')}</th>
              <th scope="col">{t('routing.col.listeners')}</th>
              <th scope="col">{t('routing.col.target')}</th>
              <th scope="col">{t('routing.col.destination')}</th>
              <th scope="col" className="text-right">
                {t('routing.col.hits')}
              </th>
              <th scope="col">{t('routing.col.enabled')}</th>
              <th scope="col">
                <span className="sr-only">{t('routing.col.rowActions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const subsetIndex = routeEntries.findIndex((e) => e.id === entry.id)
              const target = targetOf(entry)
              const shownListeners = entry.listenerIds.slice(0, 2)
              const extraCount = entry.listenerIds.length - shownListeners.length
              return (
                <tr
                  key={entry.id}
                  className={`route-stripe route-stripe-${entry.action} ${entry.enabled ? '' : 'is-disabled'}`}
                >
                  <td className="font-mono tabular-nums text-muted">{subsetIndex + 1}</td>
                  <td className="text-text">{entry.name}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {shownListeners.map((id) => (
                        <Chip key={id} label={listenerName(id)} />
                      ))}
                      {extraCount > 0 ? <span className="text-12 text-muted">+{extraCount}</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Chip label={t(entry.targetKind === 'group' ? 'enum.routeTarget.group' : 'enum.routeTarget.template')} />
                        <span className="text-13 text-text">{target.name}</span>
                      </div>
                      {entry.targetKind === 'group' ? (
                        <span className="text-12 text-muted">
                          {t('routing.groupRuleCount', { count: templateCountForGroup(entry.targetId) })}
                        </span>
                      ) : (
                        <span className="font-mono text-12 text-muted">{target.pattern}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <RouteChip route={entry.action} suffix={entry.action === 'proxy' ? upstreamName(entry.upstreamId) : undefined} />
                  </td>
                  <td className="text-right font-mono tabular-nums">{fmt.number(entry.hits)}</td>
                  <td>
                    <Toggle
                      id={`route-enabled-${entry.id}`}
                      checked={entry.enabled}
                      onChange={() => toggleRouteEntryEnabled(entry.id)}
                      label={t(entry.enabled ? 'routing.row.disable' : 'routing.row.enable', { name: entry.name })}
                      hideLabel
                    />
                  </td>
                  <td>
                    {confirmDeleteId === entry.id ? (
                      <ConfirmInline
                        message={t('routing.confirm.delete', { name: entry.name })}
                        onCancel={() => setConfirmDeleteId(null)}
                        onConfirm={() => {
                          removeRouteEntry(entry.id, { key: 'change.route.deleted', params: { name: entry.name } })
                          setConfirmDeleteId(null)
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('routing.row.moveUp', { name: entry.name })}
                          disabled={subsetIndex === 0}
                          onClick={() => moveRouteEntry(entry.id, 'up')}
                        >
                          <Icon name="chevron-up" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('routing.row.moveDown', { name: entry.name })}
                          disabled={subsetIndex === routeEntries.length - 1}
                          onClick={() => moveRouteEntry(entry.id, 'down')}
                        >
                          <Icon name="chevron-down" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('routing.row.edit', { name: entry.name })}
                          onClick={() => openEdit(entry)}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('routing.row.duplicate', { name: entry.name })}
                          onClick={() => duplicateRouteEntry(entry.id)}
                        >
                          <Icon name="duplicate" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('routing.row.delete', { name: entry.name })}
                          onClick={() => setConfirmDeleteId(entry.id)}
                        >
                          <Icon name="delete" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}

      <RouteEntryFormDrawer
        open={drawerOpen}
        editingEntry={editingEntry}
        listeners={listeners}
        ruleGroups={ruleGroups}
        ruleTemplates={ruleTemplates}
        upstreams={upstreams}
        defaultListenerId={listenerFilter !== 'all' ? listenerFilter : null}
        onClose={() => setDrawerOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
