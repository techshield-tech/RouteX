import { useEffect, useState, type ReactNode } from 'react'
import { RouteContext, readHash } from './lib/router'

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string>(readHash)

  useEffect(() => {
    const onHashChange = () => setPath(readHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return <RouteContext.Provider value={path}>{children}</RouteContext.Provider>
}
