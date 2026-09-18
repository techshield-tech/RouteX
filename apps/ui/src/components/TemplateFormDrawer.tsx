import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { matchTypeKey, matchTypeOrder } from '../i18n/enumKeys'
import type { MessageKey } from '../i18n/types'
import { patternHintKeys, validatePattern } from '../lib/validateRule'
import { Drawer } from './Drawer'
import { Select } from './Select'
import { Toggle } from './Toggle'
import type { MatchType, RuleGroup, RuleTemplate } from '../types'

export interface TemplateFormValues {
  name: string
  enabled: boolean
  matchType: MatchType
  pattern: string
  note: string
  groupId: string | null
}

function emptyValues(defaultGroupId: string | null): TemplateFormValues {
  return { name: '', enabled: true, matchType: 'domain', pattern: '', note: '', groupId: defaultGroupId }
}

function fromTemplate(template: RuleTemplate): TemplateFormValues {
  return {
    name: template.name,
    enabled: template.enabled,
    matchType: template.matchType,
    pattern: template.pattern,
    note: template.note,
    groupId: template.groupId,
  }
}

interface TemplateFormDrawerProps {
  open: boolean
  editingTemplate: RuleTemplate | null
  groups: RuleGroup[]
  defaultGroupId: string | null
  onClose: () => void
  onSubmit: (values: TemplateFormValues) => void
}

export function TemplateFormDrawer({
  open,
  editingTemplate,
  groups,
  defaultGroupId,
  onClose,
  onSubmit,
}: TemplateFormDrawerProps) {
  const { t } = useI18n()
  return (
    <Drawer
      open={open}
      title={editingTemplate ? t('drawer.template.edit.title') : t('drawer.template.add.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="template-form" className="btn-primary">
            {editingTemplate ? t('drawer.template.submit.edit') : t('drawer.template.submit.add')}
          </button>
        </>
      }
    >
      {open ? (
        <TemplateFormFields
          key={editingTemplate?.id ?? 'new'}
          editingTemplate={editingTemplate}
          groups={groups}
          defaultGroupId={defaultGroupId}
          onSubmit={onSubmit}
        />
      ) : null}
    </Drawer>
  )
}

interface TemplateFormFieldsProps {
  editingTemplate: RuleTemplate | null
  groups: RuleGroup[]
  defaultGroupId: string | null
  onSubmit: (values: TemplateFormValues) => void
}

interface TemplateFormErrors {
  name?: MessageKey
  pattern?: MessageKey
}

// Mounted only while the drawer is open, and remounted (via the parent's
// `key`) whenever the template being edited changes — so its form state
// always starts fresh without needing an effect to reset it.
function TemplateFormFields({ editingTemplate, groups, defaultGroupId, onSubmit }: TemplateFormFieldsProps) {
  const { t } = useI18n()
  const [values, setValues] = useState<TemplateFormValues>(() =>
    editingTemplate ? fromTemplate(editingTemplate) : emptyValues(defaultGroupId),
  )
  const [errors, setErrors] = useState<TemplateFormErrors>({})

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: TemplateFormErrors = {}
    if (values.name.trim() === '') {
      nextErrors.name = 'validate.rule.name'
    }
    const patternError = validatePattern(values.matchType, values.pattern)
    if (patternError) nextErrors.pattern = patternError
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSubmit({ ...values, name: values.name.trim(), pattern: values.pattern.trim() })
  }

  return (
    <form id="template-form" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="template-name" className="text-12 text-muted">
          {t('drawer.template.field.name')}
        </label>
        <input
          id="template-name"
          type="text"
          className="field-control"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'template-name-error' : undefined}
        />
        {errors.name ? (
          <p id="template-name-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
            {t(errors.name)}
          </p>
        ) : null}
      </div>

      <Toggle
        id="template-enabled"
        checked={values.enabled}
        onChange={(next) => setValues((v) => ({ ...v, enabled: next }))}
        label={t('drawer.template.field.enabled')}
      />

      <Select
        id="template-group"
        label={t('drawer.template.field.group')}
        value={values.groupId ?? ''}
        onChange={(e) => setValues((v) => ({ ...v, groupId: e.target.value || null }))}
      >
        <option value="">{t('drawer.template.group.none')}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>

      <Select
        id="template-match-type"
        label={t('drawer.rule.field.matchType')}
        value={values.matchType}
        onChange={(e) => setValues((v) => ({ ...v, matchType: e.target.value as MatchType }))}
      >
        {matchTypeOrder.map((value) => (
          <option key={value} value={value}>
            {t(matchTypeKey[value])}
          </option>
        ))}
      </Select>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="template-pattern" className="text-12 text-muted">
          {t('drawer.rule.field.pattern')}
        </label>
        <input
          id="template-pattern"
          type="text"
          className="field-control font-mono"
          value={values.pattern}
          onChange={(e) => setValues((v) => ({ ...v, pattern: e.target.value }))}
          aria-invalid={Boolean(errors.pattern)}
          aria-describedby={errors.pattern ? 'template-pattern-error' : 'template-pattern-hint'}
        />
        {errors.pattern ? (
          <p id="template-pattern-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
            {t(errors.pattern)}
          </p>
        ) : (
          <p id="template-pattern-hint" className="text-12 text-muted">
            {t(patternHintKeys[values.matchType])}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="template-note" className="text-12 text-muted">
          {t('drawer.rule.field.note')}
        </label>
        <textarea
          id="template-note"
          className="field-control"
          rows={2}
          value={values.note}
          onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
        />
      </div>
    </form>
  )
}
