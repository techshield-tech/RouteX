// Small hand-drawn stroke icon set, 16px, currentColor. No icon library.
import type { ReactElement } from 'react'

export type IconName =
  | 'overview'
  | 'rules'
  | 'templates'
  | 'routing'
  | 'listeners'
  | 'upstreams'
  | 'connections'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'system'
  | 'chevron-up'
  | 'chevron-down'
  | 'edit'
  | 'duplicate'
  | 'delete'
  | 'plus'
  | 'search'
  | 'close'
  | 'check'
  | 'refresh'
  | 'warning'
  | 'arrow-right'
  | 'eye'
  | 'eye-off'
  | 'logout'

const paths: Record<IconName, ReactNodeShape> = {
  overview: (
    <>
      <rect x="1.75" y="1.75" width="5.5" height="5.5" rx="0.75" />
      <rect x="8.75" y="1.75" width="5.5" height="8.5" rx="0.75" />
      <rect x="1.75" y="9.25" width="5.5" height="5" rx="0.75" />
    </>
  ),
  rules: (
    <>
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="10" y2="12" />
      <circle cx="12.5" cy="12" r="1.4" />
    </>
  ),
  templates: (
    <>
      <rect x="2.25" y="2.25" width="8" height="8" rx="1" />
      <path d="M5.75 6.25h7.75v7.5h-7.75Z" />
    </>
  ),
  routing: (
    <>
      <line x1="4.25" y1="13.5" x2="4.25" y2="2.5" />
      <path d="M4.25 4h6l-1.7 1.9 1.7 1.9h-6" />
      <path d="M4.25 8.7h4.4l-1.5 1.65 1.5 1.65h-4.4" />
    </>
  ),
  listeners: (
    <>
      <rect x="7.75" y="2.5" width="6.5" height="11" rx="1.2" />
      <path d="M1.5 8h5.4M4.3 5.1 7.2 8l-2.9 2.9" />
    </>
  ),
  upstreams: (
    <>
      <rect x="2" y="2.5" width="12" height="4" rx="1" />
      <rect x="2" y="9.5" width="12" height="4" rx="1" />
      <circle cx="4.5" cy="4.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  connections: (
    <>
      <circle cx="3" cy="8" r="1.6" />
      <circle cx="13" cy="3.5" r="1.6" />
      <circle cx="13" cy="12.5" r="1.6" />
      <path d="M4.4 7.3 11.6 4.2M4.4 8.7 11.6 11.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.8v2M8 12.2v2M14.2 8h-2M3.8 8h-2M12.4 3.6l-1.4 1.4M5 9.6l-1.4 1.4M12.4 12.4l-1.4-1.4M5 6.4 3.6 5" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.8v1.6M8 12.6v1.6M2.7 8h1.6M11.7 8h1.6M4.3 4.3l1.1 1.1M10.6 10.6l1.1 1.1M11.7 4.3l-1.1 1.1M5.4 10.6l-1.1 1.1" />
    </>
  ),
  moon: <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8 5.6 5.6 0 1 0 13.2 9.6Z" />,
  system: (
    <>
      <rect x="1.75" y="3" width="12.5" height="8" rx="1" />
      <line x1="5.5" y1="13.2" x2="10.5" y2="13.2" />
      <line x1="8" y1="11" x2="8" y2="13.2" />
    </>
  ),
  'chevron-up': <path d="M4 10l4-4 4 4" />,
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  edit: <path d="M10.6 2.4 13.6 5.4 5.3 13.7 2 14l0.3-3.3Z" />,
  duplicate: (
    <>
      <rect x="5.5" y="5.5" width="8.75" height="8.75" rx="1" />
      <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" />
    </>
  ),
  delete: (
    <>
      <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1" />
      <path d="M4 4.5 4.6 13a1 1 0 0 0 1 0.9h4.8a1 1 0 0 0 1-0.9l0.6-8.5" />
      <line x1="6.5" y1="7" x2="6.5" y2="11.3" />
      <line x1="9.5" y1="7" x2="9.5" y2="11.3" />
    </>
  ),
  plus: <path d="M8 2.5v11M2.5 8h11" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.4" />
      <line x1="10.2" y1="10.2" x2="14" y2="14" />
    </>
  ),
  close: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  check: <path d="M2.8 8.5 6 11.8l7.2-7.6" />,
  refresh: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" />
      <path d="M13.2 2.5v3.75H9.45" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2 14.5 13.5h-13Z" />
      <line x1="8" y1="6.3" x2="8" y2="9.3" />
      <circle cx="8" cy="11.4" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.1" />
    </>
  ),
  'arrow-right': <path d="M2.5 8h11M9.5 4l4 4-4 4" />,
  eye: (
    <>
      <path d="M1.5 8S4.2 3.2 8 3.2 14.5 8 14.5 8 11.8 12.8 8 12.8 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2.1" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M2.3 4.6C1.6 5.5 1.5 8 1.5 8s2.7 4.8 6.5 4.8c1 0 1.9-0.3 2.7-0.75" />
      <path d="M6.35 6.35A2.1 2.1 0 0 0 9.7 9.65" />
      <path d="M11 4.35C13.2 5.35 14.5 8 14.5 8s-0.6 1.05-1.65 2.1" />
      <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
    </>
  ),
  logout: (
    <>
      <path d="M6.5 2.5H3.6a1.1 1.1 0 0 0-1.1 1.1v8.8a1.1 1.1 0 0 0 1.1 1.1H6.5" />
      <path d="M9.8 5 13 8l-3.2 3M5.5 8H13" />
    </>
  ),
}

type ReactNodeShape = ReactElement | Array<ReactElement>

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
