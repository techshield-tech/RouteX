import { useMemo, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { matchTypeKey, routeActionKey } from '../i18n/enumKeys'
import type { MessageKey } from '../i18n/types'
import { Drawer } from './Drawer'
import { Select } from './Select'
import { Toggle } from './Toggle'
import { Chip } from './Chip'
import { Icon } from './Icon'
import type {
  Listener,
  RouteAction,
  RouteEntry,
  RouteTargetKind,
  RuleGroup,
  RuleTemplate,
  Upstream,
} from '../types'

export interface RouteEntryFormValues {
  name: string
  enabled: boolean
  listenerIds: string[]
  targetKind: RouteTargetKind
  targetId: string
  action: RouteAction
  upstreamId: string | null
  note: string
}

const actionOrder: RouteAction[] = ['proxy', 'direct', 'block']

function firstTarget(groups: RuleGroup[], templates: RuleTemplate[]): { kind: RouteTargetKind; id: string } {
  if (groups.length > 0) return { kind: 'group', id: groups[0].id }
  if (templates.length > 0) return { kind: 'template', id: templates[0].id }
  return { kind: 'template', id: '' }
}

function emptyValues(defaultListenerId: string | null, groups: RuleGroup[], templates: RuleTemplate[]): RouteEntryFormValues {
  const target = firstTarget(groups, templates)
  return {
    name: '',
    enabled: true,
    listenerIds: defaultListenerId ? [defaultListenerId] : [],
    targetKind: target.kind,
    targetId: target.id,
    action: 'proxy',
    upstreamId: null,
    note: '',
  }
}

function fromEntry(entry: RouteEntry): RouteEntryFormValues {
  return {
    name: entry.name,
    enabled: entry.enabled,
    listenerIds: entry.listenerIds,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    action: entry.action,
    upstreamId: entry.upstreamId,
    note: entry.note,
  }
}

interface RouteEntryFormDrawerProps {
  open: boolean
  editingEntry: RouteEntry | null
  listeners: Listener[]
  ruleGroups: RuleGroup[]
  ruleTemplates: RuleTemplate[]
  upstreams: Upstream[]
  defaultListenerId: string | null
  onClose: () => void
  onSubmit: (values: RouteEntryFormValues) => void
}

export function RouteEntryFormDrawer({
  open,
  editingEntry,
  listeners,
  ruleGroups,
  ruleTemplates,
  upstreams,
  defaultListenerId,
  onClose,
  onSubmit,
}: RouteEntryFormDrawerProps) {
  const { t } = useI18n()
  return (
    <Drawer
      open={open}
      title={editingEntry ? t('drawer.route.edit.title') : t('drawer.route.add.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="route-form" className="btn-primary">
            {editingEntry ? t('drawer.route.submit.edit') : t('drawer.route.submit.add')}
          </button>
        </>
      }
    >
      {open ? (
        <RouteEntryFormFields
          key={editingEntry?.id ?? 'new'}
          editingEntry={editingEntry}
          listeners={listeners}
          ruleGroups={ruleGroups}
          ruleTemplates={ruleTemplates}
          upstreams={upstreams}
          defaultListenerId={defaultListenerId}
          onSubmit={onSubmit}
        />
      ) : null}
    </Drawer>
  )
}

interface RouteEntryFormFieldsProps {
  editingEntry: RouteEntry | null
  listeners: Listener[]
  ruleGroups: RuleGroup[]
  ruleTemplates: RuleTemplate[]
  upstreams: Upstream[]
  defaultListenerId: string | null
  onSubmit: (values: RouteEntryFormValues) => void
}

interface RouteEntryFormErrors {
  name?: MessageKey
  listenerIds?: MessageKey
  upstreamId?: MessageKey
}

// Mounted only while the drawer is open, and remounted (via the parent's
// `key`) whenever the entry being edited changes — so its form state always
// starts fresh without needing an effect to reset it.
function RouteEntryFormFields({
  editingEntry,
  listeners,
  ruleGroups,
  ruleTemplates,
  upstreams,
  defaultListenerId,
  onSubmit,
}: RouteEntryFormFieldsProps) {
  const { t } = useI18n()
  const [values, setValues] = useState<RouteEntryFormValues>(() =>
    editingEntry ? fromEntry(editingEntry) : emptyValues(defaultListenerId, ruleGroups, ruleTemplates),
  )
  const [errors, setErrors] = useState<RouteEntryFormErrors>({})

  const templatesByGroup = useMemo(() => {
    const map = new Map<string | null, RuleTemplate[]>()
    for (const tpl of ruleTemplates) {
      const list = map.get(tpl.groupId) ?? []
      list.push(tpl)
      map.set(tpl.groupId, list)
    }
    return map
  }, [ruleTemplates])

  const groupedTemplates = ruleGroups.filter((g) => (templatesByGroup.get(g.id) ?? []).length > 0)
  const standaloneTemplates = templatesByGroup.get(null) ?? []

  const selectedGroup = values.targetKind === 'group' ? ruleGroups.find((g) => g.id === values.targetId) : undefined
  const selectedTemplate =
    values.targetKind === 'template' ? ruleTemplates.find((t2) => t2.id === values.targetId) : undefined
  const previewTemplates = selectedGroup ? templatesByGroup.get(selectedGroup.id) ?? [] : []

  const targetDisabled = selectedGroup ? !selectedGroup.enabled : selectedTemplate ? !selectedTemplate.enabled : false
  const disabledSelectedListeners = listeners.filter((l) => values.listenerIds.includes(l.id) && !l.enabled)

  function toggleListener(id: string) {
    setValues((v) => ({
      ...v,
      listenerIds: v.listenerIds.includes(id) ? v.listenerIds.filter((lid) => lid !== id) : [...v.listenerIds, id],
    }))
  }

  function selectAllListeners() {
    setValues((v) => ({ ...v, listenerIds: listeners.map((l) => l.id) }))
  }

  function switchTargetKind(kind: RouteTargetKind) {
    if (kind === values.targetKind) return
    let targetId = ''
    if (kind === 'group') {
      targetId = ruleGroups[0]?.id ?? ''
    } else {
      const firstGroupedTemplate = groupedTemplates[0] ? templatesByGroup.get(groupedTemplates[0].id)?.[0] : undefined
      targetId = firstGroupedTemplate?.id ?? standaloneTemplates[0]?.id ?? ''
    }
    setValues((v) => ({ ...v, targetKind: kind, targetId }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: RouteEntryFormErrors = {}
    if (values.name.trim() === '') {
      nextErrors.name = 'validate.rule.name'
    }
    if (values.listenerIds.length === 0) {
      nextErrors.listenerIds = 'validate.route.listeners'
    }
    if (values.action === 'proxy' && !values.upstreamId) {
      nextErrors.upstreamId = 'validate.rule.upstream'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSubmit({ ...values, name: values.name.trim() })
  }

  return (
    <form id="route-form" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="route-name" className="text-12 text-muted">
          {t('drawer.route.field.name')}
        </label>
        <input
          id="route-name"
          type="text"
          className="field-control"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'route-name-error' : undefined}
        />
        {errors.name ? (
          <p id="route-name-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
            {t(errors.name)}
          </p>
        ) : null}
      </div>

      <Toggle
        id="route-enabled"
        checked={values.enabled}
        onChange={(next) => setValues((v) => ({ ...v, enabled: next }))}
        label={t('drawer.route.field.enabled')}
      />

      <fieldset className="flex flex-col gap-2 rounded border border-line p-3">
        <legend className="px-1 text-12 text-muted">{t('drawer.route.field.listeners')}</legend>
        <div className="flex flex-col gap-2">
          {listeners.map((l) => (
            <label key={l.id} htmlFor={`route-listener-${l.id}`} className="flex items-center gap-2 text-13">
              <input
                id={`route-listener-${l.id}`}
                type="checkbox"
                checked={values.listenerIds.includes(l.id)}
                onChange={() => toggleListener(l.id)}
              />
              <span className="text-text">{l.name}</span>
              <span className="font-mono text-12 text-muted">
                {l.bind}:{l.port}
              </span>
              {!l.enabled ? <span className="text-12 text-muted">({t('listeners.field.status')}: {t('enum.listenerStatus.down')})</span> : null}
            </label>
          ))}
        </div>
        <button type="button" className="btn-secondary self-start" onClick={selectAllListeners}>
          {t('drawer.route.selectAllListeners')}
        </button>
        {errors.listenerIds ? (
          <p className="text-12" style={{ color: 'var(--rx-crit)' }}>
            {t(errors.listenerIds)}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="px-1 text-12 text-muted">{t('drawer.route.field.target')}</legend>
        <div className="segmented" role="radiogroup" aria-label={t('drawer.route.field.target')}>
          <label>
            <input
              type="radio"
              name="route-target-kind"
              checked={values.targetKind === 'group'}
              disabled={ruleGroups.length === 0}
              onChange={() => switchTargetKind('group')}
            />
            {t('enum.routeTarget.group')}
          </label>
          <label>
            <input
              type="radio"
              name="route-target-kind"
              checked={values.targetKind === 'template'}
              disabled={ruleTemplates.length === 0}
              onChange={() => switchTargetKind('template')}
            />
            {t('enum.routeTarget.template')}
          </label>
        </div>

        {values.targetKind === 'group' ? (
          <Select
            id="route-target-group"
            label={t('drawer.route.field.targetGroup')}
            hideLabel
            value={values.targetId}
            onChange={(e) => setValues((v) => ({ ...v, targetId: e.target.value }))}
          >
            {ruleGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {t('drawer.route.groupOption', { name: g.name, count: templatesByGroup.get(g.id)?.length ?? 0 })}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            id="route-target-template"
            label={t('drawer.route.field.targetTemplate')}
            hideLabel
            value={values.targetId}
            onChange={(e) => setValues((v) => ({ ...v, targetId: e.target.value }))}
          >
            {groupedTemplates.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {(templatesByGroup.get(g.id) ?? []).map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {t('drawer.route.templateOption', { name: tpl.name, pattern: tpl.pattern })}
                  </option>
                ))}
              </optgroup>
            ))}
            {standaloneTemplates.length > 0 ? (
              <optgroup label={t('templates.ungrouped')}>
                {standaloneTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {t('drawer.route.templateOption', { name: tpl.name, pattern: tpl.pattern })}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        )}

        {selectedGroup ? (
          <div className="rounded border border-line bg-surface-2 p-2.5">
            <p className="mb-1.5 text-11 font-medium text-muted uppercase tracking-wide">
              {t('drawer.route.groupPreview')}
            </p>
            <ul className="flex list-none flex-col gap-1 p-0">
              {previewTemplates.map((tpl, i) => (
                <li key={tpl.id} className="flex items-center gap-2 text-12">
                  <span className="font-mono tabular-nums text-muted">{i + 1}</span>
                  <Chip label={t(matchTypeKey[tpl.matchType])} />
                  <span className="truncate font-mono text-muted">{tpl.pattern}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {targetDisabled ? (
          <p className="warning-note">
            <Icon name="warning" />
            {t('drawer.route.warning.targetDisabled')}
          </p>
        ) : null}
      </fieldset>

      <Select
        id="route-action"
        label={t('drawer.rule.field.action')}
        value={values.action}
        onChange={(e) => setValues((v) => ({ ...v, action: e.target.value as RouteAction }))}
      >
        {actionOrder.map((value) => (
          <option key={value} value={value}>
            {t(routeActionKey[value])}
          </option>
        ))}
      </Select>

      {values.action === 'proxy' ? (
        <div className="flex flex-col gap-1.5">
          <Select
            id="route-upstream"
            label={t('drawer.rule.field.upstream')}
            value={values.upstreamId ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, upstreamId: e.target.value || null }))}
            aria-invalid={Boolean(errors.upstreamId)}
            aria-describedby={errors.upstreamId ? 'route-upstream-error' : undefined}
          >
            <option value="">{t('drawer.rule.upstream.placeholder')}</option>
            {upstreams.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          {errors.upstreamId ? (
            <p id="route-upstream-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
              {t(errors.upstreamId)}
            </p>
          ) : null}
        </div>
      ) : null}

      {disabledSelectedListeners.length > 0 ? (
        <p className="warning-note">
          <Icon name="warning" />
          {t('drawer.route.warning.listenerDisabled', {
            names: disabledSelectedListeners.map((l) => l.name).join(', '),
          })}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="route-note" className="text-12 text-muted">
          {t('drawer.rule.field.note')}
        </label>
        <textarea
          id="route-note"
          className="field-control"
          rows={2}
          value={values.note}
          onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
        />
      </div>
    </form>
  )
}
