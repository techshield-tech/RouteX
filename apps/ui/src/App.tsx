import { useEffect } from 'react'
import { RouterProvider } from './router'
import { useI18n } from './i18n/context'
import { I18nProvider } from './i18n'
import { navigate, useRoute } from './lib/router'
import { ConfigStoreProvider } from './state/useConfigStore'
import { AuthStoreProvider } from './state/useAuthStore'
import { useAuth } from './state/authContext'
import { AppShell } from './components/AppShell'
import { Overview } from './pages/Overview'
import { Templates } from './pages/Templates'
import { Routing } from './pages/Routing'
import { Listeners } from './pages/Listeners'
import { Upstreams } from './pages/Upstreams'
import { Connections } from './pages/Connections'
import { Settings } from './pages/Settings'
import { Setup } from './pages/Setup'
import { Login } from './pages/Login'

function Routes() {
  const path = useRoute()
  // `/rules` is the old path (single-listener rule lists). Redirect it to
  // the new templates library so links and bookmarks from before the split
  // still land somewhere useful.
  useEffect(() => {
    if (path === '/rules' || path.startsWith('/rules/')) navigate('/templates')
  }, [path])
  if (path === '/' || path === '') return <Overview />
  if (path === '/rules' || path.startsWith('/rules/')) return null
  if (path === '/templates') return <Templates />
  if (path === '/routing' || path.startsWith('/routing/')) return <Routing />
  if (path === '/listeners') return <Listeners />
  if (path === '/upstreams') return <Upstreams />
  if (path === '/connections') return <Connections />
  if (path === '/settings') return <Settings />
  return <NotFound path={path} />
}

function NotFound({ path }: { path: string }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-20 font-semibold text-balance">{t('app.notFound.title')}</h1>
      <p className="text-13 text-muted">
        {t('app.notFound.before')} <span className="font-mono">{`#${path}`}</span>.{' '}
        {t('app.notFound.after')}
      </p>
    </div>
  )
}

function AuthGate() {
  const { t } = useI18n()
  const { state } = useAuth()

  if (state === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-ground">
        <p className="text-13 text-muted">{t('auth.checking')}</p>
      </div>
    )
  }
  if (state === 'needsSetup') return <Setup />
  if (state === 'unauthenticated') return <Login />

  // Only mounted once signed in, so no protected request fires beforehand.
  return (
    <ConfigStoreProvider>
      <AppShell>
        <Routes />
      </AppShell>
    </ConfigStoreProvider>
  )
}

function App() {
  return (
    <I18nProvider>
      <RouterProvider>
        <AuthStoreProvider>
          <AuthGate />
        </AuthStoreProvider>
      </RouterProvider>
    </I18nProvider>
  )
}

export default App
