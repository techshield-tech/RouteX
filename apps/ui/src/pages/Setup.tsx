import { useState, type FormEvent } from 'react'
import { AuthLayout } from '../components/AuthLayout'
import { Icon } from '../components/Icon'
import { ApiError } from '../api'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { useAuth } from '../state/authContext'

const USERNAME_MAX = 64
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

interface FieldErrors {
  username?: MessageKey
  password?: MessageKey
  confirmPassword?: MessageKey
}

export function Setup() {
  const { t } = useI18n()
  const { setup, refreshStatus } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    const trimmedUsername = username.trim()
    if (trimmedUsername === '') {
      next.username = 'validate.auth.usernameRequired'
    } else if (trimmedUsername.length > USERNAME_MAX) {
      next.username = 'validate.auth.usernameTooLong'
    }
    if (password.length < PASSWORD_MIN) {
      next.password = 'validate.auth.passwordTooShort'
    } else if (password.length > PASSWORD_MAX) {
      next.password = 'validate.auth.passwordTooLong'
    }
    if (confirmPassword !== password) {
      next.confirmPassword = 'validate.auth.confirmPasswordMismatch'
    }
    return next
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const nextErrors = validate()
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      await setup({ username: username.trim(), password })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'username_required') setErrors({ username: 'validate.auth.usernameRequired' })
        else if (err.code === 'username_too_long') setErrors({ username: 'validate.auth.usernameTooLong' })
        else if (err.code === 'password_too_short') setErrors({ password: 'validate.auth.passwordTooShort' })
        else if (err.code === 'password_too_long') setErrors({ password: 'validate.auth.passwordTooLong' })
        else if (err.code === 'already_initialized') {
          setFormError(t('auth.setup.error.alreadyInitialized'))
          void refreshStatus()
        } else if (err.code === 'network_error') {
          setFormError(t('auth.error.network'))
        } else {
          setFormError(t('auth.error.generic'))
        }
      } else {
        setFormError(t('auth.error.generic'))
      }
      setSubmitting(false)
      return
    }
    setSubmitting(false)
  }

  return (
    <AuthLayout title={t('auth.setup.title')} description={t('auth.setup.description')}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <p className="text-13" style={{ color: 'var(--rx-crit)' }} role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="setup-username" className="text-12 text-muted">
            {t('auth.setup.field.username')}
          </label>
          <input
            id="setup-username"
            type="text"
            autoComplete="username"
            className="field-control"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={Boolean(errors.username)}
            aria-describedby={errors.username ? 'setup-username-error' : undefined}
          />
          {errors.username ? (
            <p id="setup-username-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.username)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="setup-password" className="text-12 text-muted">
            {t('auth.setup.field.password')}
          </label>
          <div className="relative flex items-center">
            <input
              id="setup-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="field-control pr-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'setup-password-error' : 'setup-password-hint'}
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
          {errors.password ? (
            <p id="setup-password-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.password)}
            </p>
          ) : (
            <p id="setup-password-hint" className="text-12 text-muted">
              {t('auth.hint.passwordLength')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="setup-confirm-password" className="text-12 text-muted">
            {t('auth.setup.field.confirmPassword')}
          </label>
          <input
            id="setup-confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className="field-control"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? 'setup-confirm-password-error' : undefined}
          />
          {errors.confirmPassword ? (
            <p id="setup-confirm-password-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.confirmPassword)}
            </p>
          ) : null}
        </div>

        <button type="submit" className="btn-primary justify-center" disabled={submitting}>
          {submitting ? t('auth.setup.submitting') : t('auth.setup.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
