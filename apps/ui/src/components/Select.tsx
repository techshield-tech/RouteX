import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type OptgroupHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/** Minimal event shape so call sites can keep using `(e) => ...e.target.value`. */
export interface SelectChangeEvent {
  target: { value: string }
}

interface SelectProps {
  id: string
  label: string
  hideLabel?: boolean
  value: string
  onChange: (event: SelectChangeEvent) => void
  disabled?: boolean
  className?: string
  /** Accepts <option>/<optgroup> children, parsed into the internal option list. */
  children: ReactNode
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

interface ParsedOption {
  value: string
  label: ReactNode
  text: string
  disabled: boolean
}

interface ParsedGroup {
  label: string
  options: ParsedOption[]
}

type ParsedChild = { kind: 'option'; option: ParsedOption } | { kind: 'group'; group: ParsedGroup }

interface FlatEntry {
  option: ParsedOption
}

const PANEL_MAX_HEIGHT = 280
const PANEL_GAP = 4
const TYPEAHEAD_RESET_MS = 600

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return nodeText(props.children)
  }
  return ''
}

function optionValue(raw: OptionHTMLAttributes<HTMLOptionElement>['value']): string {
  if (raw === undefined) return ''
  return typeof raw === 'string' ? raw : String(raw)
}

function parseOption(el: ReactElement<OptionHTMLAttributes<HTMLOptionElement>>): ParsedOption {
  return {
    value: optionValue(el.props.value),
    label: el.props.children,
    text: nodeText(el.props.children).trim(),
    disabled: Boolean(el.props.disabled),
  }
}

function parseChildren(children: ReactNode): ParsedChild[] {
  const result: ParsedChild[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'optgroup') {
      const groupProps = child.props as OptgroupHTMLAttributes<HTMLOptGroupElement>
      const options: ParsedOption[] = []
      Children.forEach(groupProps.children, (grandchild) => {
        if (isValidElement(grandchild) && grandchild.type === 'option') {
          options.push(parseOption(grandchild as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>))
        }
      })
      result.push({ kind: 'group', group: { label: groupProps.label ?? '', options } })
      return
    }
    if (child.type === 'option') {
      result.push({
        kind: 'option',
        option: parseOption(child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>),
      })
    }
  })
  return result
}

export function Select({
  id,
  label,
  hideLabel,
  value,
  onChange,
  disabled,
  className,
  children,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [position, setPosition] = useState({ left: 0, width: 0, top: 0, bottom: 0, openUp: false })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const typeaheadRef = useRef<{ buffer: string; timer: number | null }>({ buffer: '', timer: null })

  const parsed = useMemo(() => parseChildren(children), [children])
  const flat = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = []
    for (const item of parsed) {
      if (item.kind === 'option') out.push({ option: item.option })
      else for (const opt of item.group.options) out.push({ option: opt })
    }
    return out
  }, [parsed])

  const panelId = `${id}-listbox`
  const getOptionId = (index: number) => `${id}-option-${index}`
  const selectedIndex = flat.findIndex((entry) => entry.option.value === value)
  const selectedOption = selectedIndex >= 0 ? flat[selectedIndex].option : undefined

  function firstEnabledIndex(): number {
    return flat.findIndex((entry) => !entry.option.disabled)
  }
  function lastEnabledIndex(): number {
    for (let i = flat.length - 1; i >= 0; i -= 1) if (!flat[i].option.disabled) return i
    return -1
  }
  function nextEnabledIndex(from: number): number {
    for (let i = from + 1; i < flat.length; i += 1) if (!flat[i].option.disabled) return i
    return from
  }
  function prevEnabledIndex(from: number): number {
    for (let i = from - 1; i >= 0; i -= 1) if (!flat[i].option.disabled) return i
    return from
  }

  function openPanel() {
    if (disabled || flat.length === 0) return
    const start = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex()
    setHighlightedIndex(start)
    setOpen(true)
  }

  function closePanel() {
    setOpen(false)
  }

  function commitSelection(index: number) {
    const entry = flat[index]
    if (!entry || entry.option.disabled) return
    if (entry.option.value !== value) {
      onChange({ target: { value: entry.option.value } })
    }
    closePanel()
    triggerRef.current?.focus()
  }

  function handleTypeahead(char: string) {
    const state = typeaheadRef.current
    if (state.timer !== null) window.clearTimeout(state.timer)
    state.buffer += char.toLowerCase()
    state.timer = window.setTimeout(() => {
      state.buffer = ''
    }, TYPEAHEAD_RESET_MS)
    const buffer = state.buffer
    const matchIndex = flat.findIndex(
      (entry) => !entry.option.disabled && entry.option.text.toLowerCase().startsWith(buffer),
    )
    if (matchIndex >= 0) setHighlightedIndex(matchIndex)
  }

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openPanel()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((cur) => nextEnabledIndex(cur))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((cur) => prevEnabledIndex(cur))
        break
      case 'Home':
        e.preventDefault()
        setHighlightedIndex(firstEnabledIndex())
        break
      case 'End':
        e.preventDefault()
        setHighlightedIndex(lastEnabledIndex())
        break
      case 'Enter':
        e.preventDefault()
        commitSelection(highlightedIndex)
        break
      case 'Escape':
        e.preventDefault()
        closePanel()
        triggerRef.current?.focus()
        break
      case 'Tab':
        closePanel()
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          handleTypeahead(e.key)
        }
    }
  }

  // Position the portalled panel against the trigger, flipping above it when
  // there isn't enough room below.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const openUp = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP && spaceAbove > spaceBelow
    setPosition({
      left: rect.left,
      width: rect.width,
      top: rect.bottom + PANEL_GAP,
      bottom: viewportHeight - rect.top + PANEL_GAP,
      openUp,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlightedIndex])

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
    function dismiss(event: Event) {
      // Scrolling the panel's own option list (e.g. scrollIntoView keeping the
      // highlighted option in view) must not dismiss the panel — only scroll
      // on an outer/ancestor container or the window should.
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      closePanel()
    }
    // capture:true so scroll on any ancestor scroll container is caught too.
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  function renderOption(option: ParsedOption, index: number) {
    const optionId = getOptionId(index)
    const isSelected = option.value === value
    const isHighlighted = index === highlightedIndex
    return (
      <div
        key={optionId}
        id={optionId}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        data-highlighted={isHighlighted || undefined}
        ref={(el) => {
          optionRefs.current[index] = el
          return () => {
            optionRefs.current[index] = null
          }
        }}
        className="select-option"
        onMouseEnter={() => {
          if (!option.disabled) setHighlightedIndex(index)
        }}
        onClick={() => commitSelection(index)}
      >
        <span className="min-w-0 truncate">{option.label}</span>
        {isSelected ? <Icon name="check" className="select-option-check" /> : null}
      </div>
    )
  }

  function renderRows() {
    let index = -1
    return parsed.map((item, i) => {
      if (item.kind === 'option') {
        index += 1
        return renderOption(item.option, index)
      }
      return (
        <div key={`group-${i}`} role="group" aria-label={item.group.label}>
          <div className="select-group-label" aria-hidden="true">
            {item.group.label}
          </div>
          {item.group.options.map((opt) => {
            index += 1
            return renderOption(opt, index)
          })}
        </div>
      )
    })
  }

  const triggerClassName = ['field-control', 'select-trigger', className ?? ''].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-12 text-muted'}>
        {label}
      </label>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        aria-activedescendant={open && highlightedIndex >= 0 ? getOptionId(highlightedIndex) : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className={triggerClassName}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="min-w-0 truncate">{selectedOption?.text ?? ''}</span>
        <Icon name="chevron-down" className="select-trigger-chevron" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="listbox"
              aria-labelledby={id}
              className="select-panel z-50 shadow-lg"
              style={{
                position: 'fixed',
                left: position.left,
                width: position.width,
                top: position.openUp ? undefined : position.top,
                bottom: position.openUp ? position.bottom : undefined,
              }}
            >
              {renderRows()}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
