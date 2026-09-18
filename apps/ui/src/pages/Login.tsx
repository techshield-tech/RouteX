import { useState, type FormEvent } from 'react'
import { AuthLayout } from '../components/AuthLayout'
import { Icon } from '../components/Icon'
import { ApiError } from '../api'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { useAuth } from '../state/authContext'

interface FieldErrors {
  username?: MessageKey
}

export function Login() {
  const { t } = useI18n()
  const { login, refreshStatus } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (username.trim() === '') {
      setErrors({ username: 'validate.auth.usernameRequired' })
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      await login({ username: username.trim(), password })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'username_required') {
          setErrors({ username: 'validate.auth.usernameRequired' })
        } else if (err.code === 'invalid_credentials') {
          // Deliberately generic — the server doesn't say which of the two was wrong.
          setFormError(t('auth.login.error.invalidCredentials'))
        } else if (err.code === 'needs_setup') {
          setFormError(t('auth.login.error.needsSetup'))
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
    <AuthLayout title={t('auth.login.title')} description={t('auth.login.description')}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <p className="text-13" style={{ color: 'var(--rx-crit)' }} role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-username" className="text-12 text-muted">
            {t('auth.login.field.username')}
          </label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            className="field-control"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={Boolean(errors.username)}
            aria-describedby={errors.username ? 'login-username-error' : undefined}
          />
          {errors.username ? (
            <p id="login-username-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.username)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-password" className="text-12 text-muted">
            {t('auth.login.field.password')}
          </label>
          <div className="relative flex items-center">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="field-control pr-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        </div>

        <button type="submit" className="btn-primary justify-center" disabled={submitting}>
          {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
