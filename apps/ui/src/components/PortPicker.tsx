import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n/context'
import { fetchHostPorts, type HostPort } from '../api'
import { Icon } from './Icon'

interface PortRow {
  port: number
  inUse: boolean
  process: string | null
}

const PANEL_WIDTH = 288
const PANEL_GAP = 4

/**
 * Merges the host's port scan with ports already claimed by other listeners
 * in the working config. A port taken in config but absent from the host
 * scan (e.g. a listener added this session) still needs to show as unusable,
 * just without a process name.
 */
function buildRows(hostPorts: HostPort[], takenPorts: number[]): PortRow[] {
  const rows = new Map<number, PortRow>()
  for (const p of hostPorts) rows.set(p.port, { port: p.port, inUse: p.inUse, process: p.process })
  for (const port of takenPorts) {
    const existing = rows.get(port)
    if (existing) existing.inUse = true
    else rows.set(port, { port, inUse: true, process: null })
  }
  return Array.from(rows.values()).sort((a, b) => a.port - b.port)
}

interface PortPickerProps {
  id: string
  value: number
  onSelect: (port: number) => void
  /** Ports already used by other listeners in the working config. */
  takenPorts: number[]
}

export function PortPicker({ id, value, onSelect, takenPorts }: PortPickerProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [hostPorts, setHostPorts] = useState<HostPort[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, bottom: 0, openUp: false })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)

  function openPanel() {
    returnFocusRef.current = document.activeElement
    setOpen(true)
    if (hostPorts === null && !loading) {
      setLoading(true)
      fetchHostPorts()
        .then(setHostPorts)
        .finally(() => setLoading(false))
    }
  }

  function closePanel() {
    setOpen(false)
    const target = returnFocusRef.current
    if (target instanceof HTMLElement) target.focus()
    else triggerRef.current?.focus()
  }

  function commit(port: number) {
    onSelect(port)
    closePanel()
  }

  // Position the portalled panel against the trigger, flipping above it when
  // there isn't enough room below (same approach as Select.tsx).
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const openUp = spaceBelow < 320 && rect.top > spaceBelow
    setPosition({
      left: Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8),
      top: rect.bottom + PANEL_GAP,
      bottom: viewportHeight - rect.top + PANEL_GAP,
      openUp,
    })
  }, [open])

  // Focus the first control in the panel once it mounts.
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  }, [open])

  // Outside click closes the panel. Bubble phase only — a capture listener
  // on document would race the Drawer's own capture-phase Escape/Tab
  // handling and is not needed for a plain pointerdown check.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      closePanel()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function dismiss() {
      closePanel()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  // Escape here is a plain React (bubble-phase) handler on the panel, not a
  // document-capture listener — Drawer already installs a capture-phase
  // Escape handler on `document` while open, which would always run first
  // and close the whole drawer if this panel tried to compete for capture.
  function handlePanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closePanel()
    }
  }

  const rows = hostPorts ? buildRows(hostPorts, takenPorts) : []
  const free = rows.filter((r) => !r.inUse)
  const used = rows.filter((r) => r.inUse)
  const panelId = `${id}-panel`

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="icon-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={t('portPicker.trigger')}
        aria-label={t('portPicker.trigger')}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <Icon name="search" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={t('portPicker.title')}
              className="select-panel z-50 shadow-lg flex flex-col gap-2"
              style={{
                position: 'fixed',
                left: position.left,
                width: PANEL_WIDTH,
                top: position.openUp ? undefined : position.top,
                bottom: position.openUp ? position.bottom : undefined,
                maxHeight: 360,
              }}
              onKeyDown={handlePanelKeyDown}
            >
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <h3 className="text-12 font-medium text-muted">{t('portPicker.title')}</h3>
                <button type="button" className="icon-btn" aria-label={t('drawer.close')} onClick={closePanel}>
                  <Icon name="close" />
                </button>
              </div>

              {loading ? (
                <p className="px-1 pb-2 text-13 text-muted">{t('common.loading')}</p>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto px-1 pb-1">
                  {free.length > 0 ? (
                    <button
                      type="button"
                      className="btn-secondary justify-center text-12"
                      onClick={() => commit(free[0].port)}
                    >
                      {t('portPicker.suggest')} ({free[0].port})
                    </button>
                  ) : null}

                  <div>
                    <div className="select-group-label">{t('portPicker.free')}</div>
                    <div className="flex flex-wrap gap-1.5 px-1.5">
                      {free.map((row) => (
                        <button
                          key={row.port}
                          type="button"
                          className="chip chip-neutral font-mono tabular-nums"
                          aria-current={row.port === value || undefined}
                          onClick={() => commit(row.port)}
                        >
                          {row.port}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="select-group-label">{t('portPicker.inUse')}</div>
                    <ul className="flex flex-col gap-1 px-1.5">
                      {used.map((row) => (
                        <li key={row.port} className="flex items-center justify-between gap-2 text-13">
                          <button type="button" className="chip font-mono tabular-nums" disabled aria-disabled="true">
                            {row.port}
                          </button>
                          <span className="min-w-0 truncate text-12 text-muted">
                            {row.process ?? t('portPicker.usedByOtherListener')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
