import type { ReactNode } from 'react'
import { LanguageSelect } from './LanguageSelect'
import { RouteXMark } from './NavRail'
import { ThemeToggle } from './ThemeToggle'

/**
 * Shared chrome for the setup and login screens: a slim top bar carrying the
 * brand mark plus language/theme controls (there's no console shell yet to
 * host them), and a centered card for the form itself.
 */
export function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-ground">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line bg-surface px-4 py-3 nav:px-5">
        <span className="flex items-center gap-2 text-14 font-semibold text-text">
          <RouteXMark />
          RouteX
        </span>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[8.5rem]">
            <LanguageSelect />
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded border border-line bg-surface p-6">
          <div className="mb-5 flex flex-col gap-1">
            <h1 className="text-20 font-semibold text-balance text-text">{title}</h1>
            <p className="text-13 text-muted">{description}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
