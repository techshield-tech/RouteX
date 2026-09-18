import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { listenerProtocolKey, listenerProtocolOrder, routeActionKey } from '../i18n/enumKeys'
import type { MessageKey } from '../i18n/types'
import { Drawer } from './Drawer'
import { Toggle } from './Toggle'
import { Select } from './Select'
import { PortPicker } from './PortPicker'
import { Icon } from './Icon'
import type { DefaultAction, Listener, ListenerAuth, ListenerProtocol } from '../types'

export interface ListenerFormValues {
  name: string
  protocol: ListenerProtocol
  bind: string
  port: number
  enabled: boolean
  defaultAction: DefaultAction
  auth: ListenerAuth
}

const defaultActionOrder: DefaultAction[] = ['direct', 'block']

function emptyValues(): ListenerFormValues {
  return {
    name: '',
    protocol: 'http',
    bind: '0.0.0.0',
    port: 8080,
    enabled: true,
    defaultAction: 'direct',
    auth: { enabled: false, username: '', password: '' },
  }
}

function fromListener(listener: Listener): ListenerFormValues {
  return {
    name: listener.name,
    protocol: listener.protocol,
    bind: listener.bind,
    port: listener.port,
    enabled: listener.enabled,
    defaultAction: listener.defaultAction,
    auth: listener.auth,
  }
}

interface ListenerFormDrawerProps {
  open: boolean
  editingListener: Listener | null
  listeners: Listener[]
  onClose: () => void
  onSubmit: (values: ListenerFormValues) => void
}

export function ListenerFormDrawer({ open, editingListener, listeners, onClose, onSubmit }: ListenerFormDrawerProps) {
  const { t } = useI18n()
  return (
    <Drawer
      open={open}
      title={editingListener ? t('drawer.listener.edit.title') : t('drawer.listener.add.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="listener-form" className="btn-primary">
            {editingListener ? t('drawer.listener.submit.edit') : t('drawer.listener.submit.add')}
          </button>
        </>
      }
    >
      {open ? (
        <ListenerFormFields
          key={editingListener?.id ?? 'new'}
          editingListener={editingListener}
          listeners={listeners}
          onSubmit={onSubmit}
        />
      ) : null}
    </Drawer>
  )
}

interface ListenerFormFieldsProps {
  editingListener: Listener | null
  listeners: Listener[]
  onSubmit: (values: ListenerFormValues) => void
}

interface ListenerFormErrors {
  name?: MessageKey
  bind?: MessageKey
  port?: MessageKey
  authUsername?: MessageKey
  authPassword?: MessageKey
}

// Mounted only while the drawer is open, and remounted (via the parent's
// `key`) whenever the listener being edited changes — so its form state
// always starts fresh without needing an effect to reset it.
function ListenerFormFields({ editingListener, listeners, onSubmit }: ListenerFormFieldsProps) {
  const { t } = useI18n()
  const [values, setValues] = useState<ListenerFormValues>(() =>
    editingListener ? fromListener(editingListener) : emptyValues(),
  )
  const [errors, setErrors] = useState<ListenerFormErrors>({})
  const [showPassword, setShowPassword] = useState(false)

  // Ports already claimed by other listeners in the working config — used by
  // PortPicker to mark them unavailable. Ignores `bind` on purpose (unlike
  // the exact bind+port collision check below): a port picker that only
  // warned about the exact same bind address could still suggest a port
  // that's actually taken on a different interface, so treating any other
  // listener's port as off-limits here is the safer default.
  const takenPorts = listeners.filter((l) => l.id !== editingListener?.id).map((l) => l.port)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: ListenerFormErrors = {}
    if (values.name.trim() === '') {
      nextErrors.name = 'validate.listener.name'
    }
    if (values.bind.trim() === '') {
      nextErrors.bind = 'validate.listener.bind'
    }
    if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65535) {
      nextErrors.port = 'validate.port'
    }
    if (!nextErrors.bind && !nextErrors.port) {
      const bind = values.bind.trim()
      const collides = listeners.some(
        (l) => l.id !== editingListener?.id && l.bind === bind && l.port === values.port,
      )
      if (collides) {
        nextErrors.bind = 'validate.listener.bindCollision'
      }
    }
    if (values.auth.enabled) {
      if (values.auth.username.trim() === '') {
        nextErrors.authUsername = 'validate.listener.authUsername'
      }
      if (values.auth.password === '') {
        nextErrors.authPassword = 'validate.listener.authPassword'
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    // Auth fields typed before switching the toggle off would otherwise
    // survive in state — reset them so a disabled auth block never submits
    // leftover credentials.
    const auth: ListenerAuth = values.auth.enabled
      ? { enabled: true, username: values.auth.username.trim(), password: values.auth.password }
      : { enabled: false, username: '', password: '' }
    onSubmit({ ...values, name: values.name.trim(), bind: values.bind.trim(), auth })
  }

  return (
    <form id="listener-form" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="listener-name" className="text-12 text-muted">
          {t('drawer.listener.field.name')}
        </label>
        <input
          id="listener-name"
          type="text"
          className="field-control"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'listener-name-error' : undefined}
        />
        {errors.name ? (
          <p id="listener-name-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
            {t(errors.name)}
          </p>
        ) : null}
      </div>

      <Select
        id="listener-protocol"
        label={t('drawer.listener.field.protocol')}
        value={values.protocol}
        onChange={(e) => setValues((v) => ({ ...v, protocol: e.target.value as ListenerProtocol }))}
      >
        {listenerProtocolOrder.map((value) => (
          <option key={value} value={value}>
            {t(listenerProtocolKey[value])}
          </option>
        ))}
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="listener-bind" className="text-12 text-muted">
            {t('drawer.listener.field.bind')}
          </label>
          <input
            id="listener-bind"
            type="text"
            className="field-control font-mono"
            value={values.bind}
            onChange={(e) => setValues((v) => ({ ...v, bind: e.target.value }))}
            aria-invalid={Boolean(errors.bind)}
            aria-describedby={errors.bind ? 'listener-bind-error' : undefined}
          />
          {errors.bind ? (
            <p id="listener-bind-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.bind)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="listener-port" className="text-12 text-muted">
              {t('drawer.listener.field.port')}
            </label>
            <PortPicker
              id="listener-port-picker"
              value={values.port}
              takenPorts={takenPorts}
              onSelect={(port) => setValues((v) => ({ ...v, port }))}
            />
          </div>
          <input
            id="listener-port"
            type="number"
            min={1}
            max={65535}
            className="field-control font-mono"
            value={values.port}
            onChange={(e) => setValues((v) => ({ ...v, port: Number(e.target.value) }))}
            aria-invalid={Boolean(errors.port)}
            aria-describedby={errors.port ? 'listener-port-error' : undefined}
          />
          {errors.port ? (
            <p id="listener-port-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.port)}
            </p>
          ) : null}
        </div>
      </div>

      <Toggle
        id="listener-enabled"
        checked={values.enabled}
        onChange={(next) => setValues((v) => ({ ...v, enabled: next }))}
        label={t('drawer.listener.field.enabled')}
      />

      <div className="flex flex-col gap-3 rounded border border-line bg-surface-2 p-3">
        <Toggle
          id="listener-auth-enabled"
          checked={values.auth.enabled}
          onChange={(next) => setValues((v) => ({ ...v, auth: { ...v.auth, enabled: next } }))}
          label={t('drawer.listener.field.authEnabled')}
        />

        {values.auth.enabled ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="listener-auth-username" className="text-12 text-muted">
                {t('drawer.listener.field.authUsername')}
              </label>
              <input
                id="listener-auth-username"
                type="text"
                className="field-control"
                value={values.auth.username}
                onChange={(e) => setValues((v) => ({ ...v, auth: { ...v.auth, username: e.target.value } }))}
                aria-invalid={Boolean(errors.authUsername)}
                aria-describedby={errors.authUsername ? 'listener-auth-username-error' : undefined}
              />
              {errors.authUsername ? (
                <p id="listener-auth-username-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
                  {t(errors.authUsername)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="listener-auth-password" className="text-12 text-muted">
                {t('drawer.listener.field.authPassword')}
              </label>
              <div className="relative flex items-center">
                <input
                  id="listener-auth-password"
                  type={showPassword ? 'text' : 'password'}
                  className="field-control pr-9"
                  value={values.auth.password}
                  onChange={(e) => setValues((v) => ({ ...v, auth: { ...v.auth, password: e.target.value } }))}
                  aria-invalid={Boolean(errors.authPassword)}
                  aria-describedby={errors.authPassword ? 'listener-auth-password-error' : undefined}
                />
                <button
                  type="button"
                  className="icon-btn absolute right-1"
                  style={{ width: 22, height: 22 }}
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={t(showPassword ? 'drawer.listener.field.hidePassword' : 'drawer.listener.field.showPassword')}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} />
                </button>
              </div>
              {errors.authPassword ? (
                <p id="listener-auth-password-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
                  {t(errors.authPassword)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <Select
        id="listener-default-action"
        label={t('drawer.listener.field.defaultAction')}
        value={values.defaultAction}
        onChange={(e) => setValues((v) => ({ ...v, defaultAction: e.target.value as DefaultAction }))}
      >
        {defaultActionOrder.map((value) => (
          <option key={value} value={value}>
            {t(routeActionKey[value])}
          </option>
        ))}
      </Select>
    </form>
  )
}
