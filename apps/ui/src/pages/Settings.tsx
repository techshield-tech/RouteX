import { useState, type FormEvent } from 'react'
import { useConfigStore } from '../state/configContext'
import { useAuth } from '../state/authContext'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { dnsResolveModeKey, dnsResolveModeOrder, logLevelKey, logLevelOrder } from '../i18n/enumKeys'
import { PageHeader } from '../components/PageHeader'
import { Toggle } from '../components/Toggle'
import { Select } from '../components/Select'
import { Icon } from '../components/Icon'
import { ApiError } from '../api'
import type { Settings as SettingsType } from '../types'

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-14 font-medium text-balance text-text">{title}</h2>
      <p className="mt-0.5 text-12 text-muted">{description}</p>
    </div>
  )
}

export function Settings() {
  const { t } = useI18n()
  const { settings, updateSettings } = useConfigStore()

  if (!settings) {
    return (
      <div>
        <PageHeader title={t('settings.title')} description={t('settings.description')} />
        <p className="mt-6 text-13 text-muted">{t('common.loading')}</p>
      </div>
    )
  }

  const draft = settings

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />

      <section className="flex flex-col gap-4 border-b border-line pb-8">
        <SectionHeading
          title={t('settings.routing.title')}
          description={t('settings.routing.description')}
        />
        <p className="text-12 text-muted">
          {t('settings.routing.listenersNote')}{' '}
          <a href="#/listeners" className="text-accent underline underline-offset-2 hover:text-accent-strong">
            {t('settings.routing.listenersNote.link')}
          </a>
        </p>
        <div className="grid grid-cols-1 gap-4 nav:grid-cols-2">
          <Select
            id="routing-dns-mode"
            label={t('settings.routing.dnsMode')}
            value={draft.routing.dnsResolveMode}
            onChange={(e) => {
              const dnsResolveMode = e.target.value as SettingsType['routing']['dnsResolveMode']
              updateSettings(
                { routing: { ...draft.routing, dnsResolveMode } },
                { key: 'change.settings.dnsMode', params: { mode: t(dnsResolveModeKey[dnsResolveMode]) } },
              )
            }}
          >
            {dnsResolveModeOrder.map((value) => (
              <option key={value} value={value}>
                {t(dnsResolveModeKey[value])}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-4 border-b border-line pb-8">
        <SectionHeading
          title={t('settings.logging.title')}
          description={t('settings.logging.description')}
        />
        <div className="grid grid-cols-1 gap-4 nav:grid-cols-2">
          <Select
            id="logging-level"
            label={t('settings.logging.level')}
            value={draft.logging.level}
            onChange={(e) => {
              const level = e.target.value as SettingsType['logging']['level']
              updateSettings(
                { logging: { ...draft.logging, level } },
                { key: 'change.settings.logLevel', params: { level: t(logLevelKey[level]) } },
              )
            }}
          >
            {logLevelOrder.map((value) => (
              <option key={value} value={value}>
                {t(logLevelKey[value])}
              </option>
            ))}
          </Select>
          <div className="flex items-end pb-1.5">
            <Toggle
              id="logging-access-log"
              checked={draft.logging.accessLog}
              onChange={(next) =>
                updateSettings(
                  { logging: { ...draft.logging, accessLog: next } },
                  { key: next ? 'change.settings.accessLogOn' : 'change.settings.accessLogOff' },
                )
              }
              label={t('settings.logging.accessLog')}
            />
          </div>
        </div>
      </section>

      <AccountSection />
    </div>
  )
}

const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

interface PasswordFormErrors {
  currentPassword?: MessageKey
  newPassword?: MessageKey
  confirmPassword?: MessageKey
}

function AccountSection() {
  const { t } = useI18n()
  const { username, changePassword } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [errors, setErrors] = useState<PasswordFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function resetFields() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSuccess(false)

    const nextErrors: PasswordFormErrors = {}
    if (currentPassword === '') nextErrors.currentPassword = 'validate.auth.currentPasswordRequired'
    if (newPassword.length < PASSWORD_MIN) nextErrors.newPassword = 'validate.auth.passwordTooShort'
    else if (newPassword.length > PASSWORD_MAX) nextErrors.newPassword = 'validate.auth.passwordTooLong'
    if (confirmPassword !== newPassword) nextErrors.confirmPassword = 'validate.auth.confirmPasswordMismatch'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      await changePassword({ currentPassword, newPassword })
      resetFields()
      setSuccess(true)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_credentials') {
          setErrors({ currentPassword: 'auth.settings.error.currentPasswordIncorrect' })
        } else if (err.code === 'password_too_short') {
          setErrors({ newPassword: 'validate.auth.passwordTooShort' })
        } else if (err.code === 'password_too_long') {
          setErrors({ newPassword: 'validate.auth.passwordTooLong' })
        } else if (err.code === 'network_error') {
          setFormError(t('auth.error.network'))
        } else {
          setFormError(t('auth.error.generic'))
        }
      } else {
        setFormError(t('auth.error.generic'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={t('settings.account.title')}
        description={t('settings.account.description', { username: username ?? '' })}
      />
      <form className="flex max-w-sm flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <p className="text-13" style={{ color: 'var(--rx-crit)' }} role="alert">
            {formError}
          </p>
        ) : null}
        {success ? (
          <p className="text-13" style={{ color: 'var(--rx-ok)' }} role="status">
            {t('auth.settings.success')}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="account-current-password" className="text-12 text-muted">
            {t('settings.account.field.currentPassword')}
          </label>
          <input
            id="account-current-password"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="current-password"
            className="field-control"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            aria-invalid={Boolean(errors.currentPassword)}
            aria-describedby={errors.currentPassword ? 'account-current-password-error' : undefined}
          />
          {errors.currentPassword ? (
            <p id="account-current-password-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.currentPassword)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="account-new-password" className="text-12 text-muted">
            {t('settings.account.field.newPassword')}
          </label>
          <input
            id="account-new-password"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            className="field-control"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={Boolean(errors.newPassword)}
            aria-describedby={errors.newPassword ? 'account-new-password-error' : 'account-new-password-hint'}
          />
          {errors.newPassword ? (
            <p id="account-new-password-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.newPassword)}
            </p>
          ) : (
            <p id="account-new-password-hint" className="text-12 text-muted">
              {t('auth.hint.passwordLength')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="account-confirm-password" className="text-12 text-muted">
            {t('settings.account.field.confirmPassword')}
          </label>
          <input
            id="account-confirm-password"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            className="field-control"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? 'account-confirm-password-error' : undefined}
          />
          {errors.confirmPassword ? (
            <p id="account-confirm-password-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.confirmPassword)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-12 text-muted hover:text-text"
            onClick={() => setShowPasswords((s) => !s)}
          >
            <Icon name={showPasswords ? 'eye-off' : 'eye'} />
            {t(showPasswords ? 'drawer.listener.field.hidePassword' : 'drawer.listener.field.showPassword')}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t('settings.account.submitting') : t('settings.account.submit')}
          </button>
        </div>
      </form>
    </section>
  )
}
