import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { Drawer } from './Drawer'
import { Toggle } from './Toggle'
import { Select } from './Select'
import type { Upstream, UpstreamScheme } from '../types'

export interface UpstreamFormValues {
  name: string
  scheme: UpstreamScheme
  host: string
  port: number
  hasAuth: boolean
}

function emptyValues(): UpstreamFormValues {
  return { name: '', scheme: 'http', host: '', port: 8080, hasAuth: false }
}

function fromUpstream(u: Upstream): UpstreamFormValues {
  return { name: u.name, scheme: u.scheme, host: u.host, port: u.port, hasAuth: u.hasAuth }
}

interface UpstreamFormDrawerProps {
  open: boolean
  editingUpstream: Upstream | null
  onClose: () => void
  onSubmit: (values: UpstreamFormValues) => void
}

export function UpstreamFormDrawer({ open, editingUpstream, onClose, onSubmit }: UpstreamFormDrawerProps) {
  const { t } = useI18n()
  return (
    <Drawer
      open={open}
      title={editingUpstream ? t('drawer.upstream.edit.title') : t('drawer.upstream.add.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="upstream-form" className="btn-primary">
            {editingUpstream ? t('drawer.upstream.submit.edit') : t('drawer.upstream.submit.add')}
          </button>
        </>
      }
    >
      {open ? (
        <UpstreamFormFields key={editingUpstream?.id ?? 'new'} editingUpstream={editingUpstream} onSubmit={onSubmit} />
      ) : null}
    </Drawer>
  )
}

interface UpstreamFormFieldsProps {
  editingUpstream: Upstream | null
  onSubmit: (values: UpstreamFormValues) => void
}

// Mounted only while the drawer is open, and remounted (via the parent's
// `key`) whenever the upstream being edited changes — so its form state
// always starts fresh without needing an effect to reset it.
function UpstreamFormFields({ editingUpstream, onSubmit }: UpstreamFormFieldsProps) {
  const { t } = useI18n()
  const [values, setValues] = useState<UpstreamFormValues>(() =>
    editingUpstream ? fromUpstream(editingUpstream) : emptyValues(),
  )
  const [errors, setErrors] = useState<{ name?: MessageKey; host?: MessageKey; port?: MessageKey }>({})

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (values.name.trim() === '') {
      nextErrors.name = 'validate.upstream.name'
    }
    if (values.host.trim() === '') {
      nextErrors.host = 'validate.upstream.host'
    }
    if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65535) {
      nextErrors.port = 'validate.port'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSubmit({ ...values, name: values.name.trim(), host: values.host.trim() })
  }

  return (
    <form id="upstream-form" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
          <label htmlFor="upstream-name" className="text-12 text-muted">
            {t('drawer.upstream.field.name')}
          </label>
          <input
            id="upstream-name"
            type="text"
            className="field-control"
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'upstream-name-error' : undefined}
          />
          {errors.name ? (
            <p id="upstream-name-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.name)}
            </p>
          ) : null}
        </div>

        <Select
          id="upstream-scheme"
          label={t('drawer.upstream.field.scheme')}
          value={values.scheme}
          onChange={(e) => setValues((v) => ({ ...v, scheme: e.target.value as UpstreamScheme }))}
        >
          <option value="http">http</option>
          <option value="socks5">socks5</option>
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="upstream-host" className="text-12 text-muted">
              {t('drawer.upstream.field.host')}
            </label>
            <input
              id="upstream-host"
              type="text"
              className="field-control font-mono"
              value={values.host}
              onChange={(e) => setValues((v) => ({ ...v, host: e.target.value }))}
              aria-invalid={Boolean(errors.host)}
              aria-describedby={errors.host ? 'upstream-host-error' : undefined}
            />
            {errors.host ? (
              <p id="upstream-host-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
                {t(errors.host)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="upstream-port" className="text-12 text-muted">
              {t('drawer.upstream.field.port')}
            </label>
            <input
              id="upstream-port"
              type="number"
              min={1}
              max={65535}
              className="field-control font-mono"
              value={values.port}
              onChange={(e) => setValues((v) => ({ ...v, port: Number(e.target.value) }))}
              aria-invalid={Boolean(errors.port)}
              aria-describedby={errors.port ? 'upstream-port-error' : undefined}
            />
            {errors.port ? (
              <p id="upstream-port-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
                {t(errors.port)}
              </p>
            ) : null}
          </div>
        </div>

      <Toggle
        id="upstream-auth"
        checked={values.hasAuth}
        onChange={(next) => setValues((v) => ({ ...v, hasAuth: next }))}
        label={t('drawer.upstream.field.auth')}
      />
    </form>
  )
}
