import { createContext, useContext } from 'react'

export function readHash(): string {
  const raw = window.location.hash.replace(/^#/, '')
  return raw === '' ? '/' : raw
}

export const RouteContext = createContext<string>('/')

export function useRoute(): string {
  return useContext(RouteContext)
}

export function navigate(path: string): void {
  window.location.hash = path
}

export function isActivePath(current: string, target: string): boolean {
  if (target === '/') return current === '/'
  return current === target || current.startsWith(`${target}/`)
}
