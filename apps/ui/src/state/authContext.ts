import { createContext, useContext } from 'react'

/**
 * `checking`: the initial `/auth/status` call hasn't resolved yet.
 * `needsSetup`: no admin account exists — show the setup screen.
 * `unauthenticated`: an account exists but this browser has no valid session.
 * `authenticated`: signed in — the console itself can mount.
 */
export type AuthState = 'checking' | 'needsSetup' | 'unauthenticated' | 'authenticated'

export interface AuthContextValue {
  state: AuthState
  /** The signed-in user's name. Only meaningful when `state === 'authenticated'`. */
  username: string | null
  setup: (input: { username: string; password: string }) => Promise<void>
  login: (input: { username: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>
  /** Re-runs the initial `/auth/status` check. Used after a setup/login call
   * fails with a code that means this screen is now the wrong one to be on
   * (e.g. someone else finished setup first), to move to the right screen. */
  refreshStatus: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthStoreProvider')
  return ctx
}
