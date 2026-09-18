import { useState } from 'react'
import { useConfigStore } from '../state/configContext'
import { testUpstreamConnection } from '../api'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { PageHeader } from '../components/PageHeader'
import { Icon } from '../components/Icon'
import { HealthPill } from '../components/StatusPill'
import { UpstreamFormDrawer, type UpstreamFormValues } from '../components/UpstreamFormDrawer'
import type { Upstream } from '../types'

interface TestOutcome {
  id: string
  ok: boolean
  messageKey: MessageKey
  latencyMs: number | null
}

export function Upstreams() {
  const { t, fmt } = useI18n()
  const { upstreams, addUpstream, updateUpstream, setUpstreamProbe, routeEntryCountForUpstream } = useConfigStore()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingUpstream, setEditingUpstream] = useState<Upstream | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestOutcome | null>(null)

  function openAdd() {
    setEditingUpstream(null)
    setDrawerOpen(true)
  }
  function openEdit(u: Upstream) {
    setEditingUpstream(u)
    setDrawerOpen(true)
  }

  function handleSubmit(values: UpstreamFormValues) {
    if (editingUpstream) {
      updateUpstream(editingUpstream.id, values, {
        key: 'change.upstream.edited',
        params: { name: values.name },
      })
    } else {
      addUpstream(values)
    }
    setDrawerOpen(false)
  }

  async function handleTest(upstream: Upstream) {
    setTestingId(upstream.id)
    setTestResult(null)
    const result = await testUpstreamConnection(upstream.id)
    setUpstreamProbe(upstream.id, result.health, result.latencyMs)
    setTestResult({
      id: upstream.id,
      ok: result.ok,
      latencyMs: result.latencyMs,
      messageKey: result.ok
        ? 'upstreams.test.ok'
        : result.error === 'timeout'
          ? 'upstreams.test.timeout'
          : 'upstreams.test.failed',
    })
    setTestingId(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('upstreams.title')}
        description={t('upstreams.description')}
        action={
          <button type="button" className="btn-primary" onClick={openAdd}>
            <Icon name="plus" />
            {t('upstreams.add')}
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 nav:grid-cols-3">
        {upstreams.map((u) => {
          const isTesting = testingId === u.id
          const result = testResult?.id === u.id ? testResult : null
          return (
            <div key={u.id} className="flex flex-col gap-3 rounded border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-14 font-medium text-balance text-text">{u.name}</h2>
                <span className="chip chip-neutral">{u.scheme}</span>
              </div>
              <p className="font-mono text-12 text-muted">
                {u.host}:{u.port}
              </p>
              <dl className="flex flex-col gap-1.5 text-13">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">{t('upstreams.field.auth')}</dt>
                  <dd>{u.hasAuth ? t('upstreams.auth.required') : t('upstreams.auth.none')}</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-muted">{t('upstreams.field.health')}</dt>
                  <dd className="flex items-center gap-2">
                    <HealthPill health={u.health} />
                    {u.latencyMs !== null ? (
                      <span className="font-mono text-12 tabular-nums text-muted">
                        {fmt.milliseconds(u.latencyMs)}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">{t('upstreams.field.ruleCount')}</dt>
                  <dd className="font-mono tabular-nums">{fmt.number(routeEntryCountForUpstream(u.id))}</dd>
                </div>
              </dl>
              {result ? (
                <p className="text-12" style={{ color: result.ok ? 'var(--rx-ok)' : 'var(--rx-crit)' }}>
                  {t(result.messageKey, {
                    latency: result.latencyMs === null ? '' : fmt.milliseconds(result.latencyMs),
                  })}
                </p>
              ) : null}
              {/* `grow` (not `flex-1`) keeps each button at its content width as
                  the wrap basis, so a longer translated label moves to its own
                  line instead of being squeezed and clipped. */}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <button type="button" className="btn-secondary grow justify-center" onClick={() => openEdit(u)}>
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="btn-secondary grow justify-center"
                  onClick={() => void handleTest(u)}
                  disabled={isTesting}
                >
                  {isTesting ? t('upstreams.testing') : t('upstreams.test')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <UpstreamFormDrawer
        open={drawerOpen}
        editingUpstream={editingUpstream}
        onClose={() => setDrawerOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
