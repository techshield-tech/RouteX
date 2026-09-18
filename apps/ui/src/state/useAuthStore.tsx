import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../api'
import { AuthContext, type AuthState } from './authContext'

export function AuthStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('checking')
  const [username, setUsername] = useState<string | null>(null)

  // Single place that turns an `/auth/status` response into local state, so
  // both the initial check and a post-error recheck (e.g. after "account
  // already exists" on the setup screen) go through the same logic.
  const applyAuthStatus = useCallback((status: Awaited<ReturnType<typeof api.fetchAuthStatus>>) => {
    if (status.needsSetup) {
      api.setToken(null)
      setUsername(null)
      setState('needsSetup')
    } else if (status.authenticated) {
      setUsername(status.username)
      setState('authenticated')
    } else {
      // A stored token exists but the server doesn't recognize it (expired,
      // server restarted, etc.) — drop it rather than keep sending it.
      api.setToken(null)
      setUsername(null)
      setState('unauthenticated')
    }
  }, [])

  const handleAuthStatusError = useCallback(() => {
    // Couldn't reach the server — don't get stuck on the loading screen;
    // land on login, which will surface a fresh error if it also fails.
    setUsername(null)
    setState('unauthenticated')
  }, [])

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.fetchAuthStatus()
      applyAuthStatus(status)
    } catch {
      handleAuthStatusError()
    }
  }, [applyAuthStatus, handleAuthStatusError])

  useEffect(() => {
    api.fetchAuthStatus().then(applyAuthStatus).catch(handleAuthStatusError)
  }, [applyAuthStatus, handleAuthStatusError])

  // A 401 from anywhere else in the app means the session died underneath
  // it — fall back to the login screen instead of showing stale data.
  useEffect(() => {
    return api.onUnauthorized(() => {
      setUsername(null)
      setState('unauthenticated')
    })
  }, [])

  const setup = useCallback(async (input: { username: string; password: string }) => {
    const session = await api.setupAccount(input)
    api.setToken(session.token)
    setUsername(session.username)
    setState('authenticated')
  }, [])

  const login = useCallback(async (input: { username: string; password: string }) => {
    const session = await api.login(input)
    api.setToken(session.token)
    setUsername(session.username)
    setState('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // Best-effort — the local session is cleared regardless below.
    } finally {
      api.setToken(null)
      setUsername(null)
      setState('unauthenticated')
    }
  }, [])

  const changePassword = useCallback(async (input: { currentPassword: string; newPassword: string }) => {
    const session = await api.changePassword(input)
    api.setToken(session.token)
    setUsername(session.username)
  }, [])

  const value = useMemo(
    () => ({ state, username, setup, login, logout, changePassword, refreshStatus: checkStatus }),
    [state, username, setup, login, logout, changePassword, checkStatus],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
