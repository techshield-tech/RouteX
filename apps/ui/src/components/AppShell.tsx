import type { ReactNode } from 'react'
import { NavRail } from './NavRail'
import { ErrorBanner } from './ErrorBanner'
import { PendingChangesBar } from './PendingChangesBar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <ErrorBanner />
      <div className="flex min-h-0 flex-1 flex-col nav:flex-row">
        <NavRail />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-5 nav:px-5">{children}</div>
        </main>
      </div>
      <PendingChangesBar />
    </div>
  )
}
