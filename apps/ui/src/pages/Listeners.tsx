import { useState } from 'react'
import { useConfigStore } from '../state/configContext'
import { useI18n } from '../i18n/context'
import { listenerProtocolKey, routeActionKey } from '../i18n/enumKeys'
import { PageHeader } from '../components/PageHeader'
import { Icon } from '../components/Icon'
import { ListenerStatusPill } from '../components/StatusPill'
import { Toggle } from '../components/Toggle'
import { ConfirmInline } from '../components/ConfirmInline'
import { EmptyState } from '../components/EmptyState'
import { ListenerFormDrawer, type ListenerFormValues } from '../components/ListenerFormDrawer'
import { navigate } from '../lib/router'
import type { Listener } from '../types'

export function Listeners() {
  const { t, fmt } = useI18n()
  const {
    listeners,
    addListener,
    updateListener,
    removeListener,
    toggleListenerEnabled,
    routeEntryCountForListener,
  } = useConfigStore()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingListener, setEditingListener] = useState<Listener | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function openAdd() {
    setEditingListener(null)
    setDrawerOpen(true)
  }
  function openEdit(listener: Listener) {
    setEditingListener(listener)
    setDrawerOpen(true)
  }

  function handleSubmit(values: ListenerFormValues) {
    if (editingListener) {
      updateListener(editingListener.id, values, {
        key: 'change.listener.edited',
        params: { name: values.name },
      })
    } else {
      addListener(values)
    }
    setDrawerOpen(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('listeners.title')}
        description={t('listeners.description')}
        action={
          <button type="button" className="btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            {t('listeners.add')}
          </button>
        }
      />

      {listeners.length === 0 ? (
        <EmptyState message={t('listeners.empty')} actionLabel={t('listeners.add')} onAction={openAdd} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 nav:grid-cols-3">
          {listeners.map((listener) => {
            const routeCount = routeEntryCountForListener(listener.id)
            return (
              <div key={listener.id} className="flex flex-col gap-3 rounded border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-14 font-medium text-balance text-text">{listener.name}</h2>
                  <span className="chip chip-neutral">{t(listenerProtocolKey[listener.protocol])}</span>
                </div>
                <p className="font-mono text-12 text-muted">
                  {listener.bind}:{listener.port}
                </p>
                <dl className="flex flex-col gap-1.5 text-13">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted">{t('listeners.field.status')}</dt>
                    <dd>
                      <ListenerStatusPill status={listener.status} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted">{t('listeners.field.connections')}</dt>
                    <dd className="font-mono tabular-nums">{fmt.number(listener.connections)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted">{t('listeners.field.ruleCount')}</dt>
                    <dd className="font-mono tabular-nums">{fmt.number(routeCount)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted">{t('listeners.field.defaultAction')}</dt>
                    <dd>{t(routeActionKey[listener.defaultAction])}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted">{t('listeners.field.auth')}</dt>
                    {listener.auth.enabled ? (
                      <dd className="min-w-0 truncate font-mono">{listener.auth.username}</dd>
                    ) : (
                      <dd className="text-muted">{t('listeners.field.authNone')}</dd>
                    )}
                  </div>
                </dl>

                {confirmDeleteId === listener.id ? (
                  <ConfirmInline
                    message={t('listeners.confirm.delete', { name: listener.name, count: routeCount })}
                    onCancel={() => setConfirmDeleteId(null)}
                    onConfirm={() => {
                      removeListener(listener.id, {
                        key: 'change.listener.deleted',
                        params: { name: listener.name, count: routeCount },
                      })
                      setConfirmDeleteId(null)
                    }}
                  />
                ) : (
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      className="btn-secondary grow justify-center"
                      onClick={() => openEdit(listener)}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary grow justify-center"
                      onClick={() => navigate(`/routing/${listener.id}`)}
                    >
                      {t('listeners.viewRules')}
                    </button>
                    <Toggle
                      id={`listener-enabled-${listener.id}`}
                      checked={listener.enabled}
                      onChange={() => toggleListenerEnabled(listener.id)}
                      label={t(listener.enabled ? 'listeners.row.disable' : 'listeners.row.enable', {
                        name: listener.name,
                      })}
                      hideLabel
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('listeners.row.delete', { name: listener.name })}
                      onClick={() => setConfirmDeleteId(listener.id)}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ListenerFormDrawer
        open={drawerOpen}
        editingListener={editingListener}
        listeners={listeners}
        onClose={() => setDrawerOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
