import { useState } from 'react'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { isActivePath, useRoute } from '../lib/router'
import { useAuth } from '../state/authContext'
import { Icon, type IconName } from './Icon'
import { LanguageSelect } from './LanguageSelect'
import { ThemeToggle } from './ThemeToggle'

const VERSION = 'v0.1.0'

const navItems: { path: string; labelKey: MessageKey; icon: IconName }[] = [
  { path: '/', labelKey: 'nav.overview', icon: 'overview' },
  { path: '/templates', labelKey: 'nav.templates', icon: 'templates' },
  { path: '/routing', labelKey: 'nav.routing', icon: 'routing' },
  { path: '/listeners', labelKey: 'nav.listeners', icon: 'listeners' },
  { path: '/upstreams', labelKey: 'nav.upstreams', icon: 'upstreams' },
  { path: '/connections', labelKey: 'nav.connections', icon: 'connections' },
  { path: '/settings', labelKey: 'nav.settings', icon: 'settings' },
]

export function NavRail() {
  const { t } = useI18n()
  const route = useRoute()
  const { username, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <nav
      aria-label={t('nav.label')}
      className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface px-3 py-3 nav:w-[240px] nav:border-b-0 nav:border-r nav:px-4 nav:py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 nav:flex-col nav:items-start nav:gap-2">
        <a href="#/" className="flex items-center gap-2 text-14 font-semibold text-text no-underline">
          <RouteXMark />
          RouteX
        </a>
        <span className="inline-flex items-center gap-1.5 text-12 text-muted">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--rx-ok)' }}
            aria-hidden="true"
          />
          {t('nav.engineRunning')}
        </span>
      </div>

      <ul className="flex list-none gap-1 overflow-x-auto p-0 nav:flex-col nav:overflow-visible">
        {navItems.map((item) => {
          const active = isActivePath(route, item.path)
          return (
            <li key={item.path} className="shrink-0 nav:shrink">
              <a
                href={`#${item.path}`}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-13 whitespace-nowrap no-underline nav:whitespace-normal ${
                  active ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                <Icon name={item.icon} className="shrink-0" />
                {t(item.labelKey)}
              </a>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col gap-3 nav:mt-auto">
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="min-w-0 truncate text-13 text-text" title={username ?? undefined}>
            {username}
          </span>
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label={t('nav.account.logout')}
            title={t('nav.account.logout')}
          >
            <Icon name="logout" />
          </button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 nav:flex-col nav:items-stretch nav:gap-3">
          <div className="min-w-[8.5rem] flex-1 nav:w-full nav:flex-none">
            <LanguageSelect />
          </div>
          <ThemeToggle />
          <span className="text-11 text-muted" title={t('nav.version', { version: VERSION })}>
            {VERSION}
          </span>
        </div>
      </div>
    </nav>
  )
}

export function RouteXMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.4" cy="8" r="1.9" stroke="var(--rx-route-direct)" strokeWidth="1.4" />
      <circle cx="12.6" cy="3.2" r="1.9" stroke="var(--rx-accent)" strokeWidth="1.4" />
      <circle cx="12.6" cy="12.8" r="1.9" stroke="var(--rx-route-block)" strokeWidth="1.4" />
      <path d="M5.1 7.2 10.9 4" stroke="var(--rx-accent)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.1 8.8 10.9 12" stroke="var(--rx-route-block)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
