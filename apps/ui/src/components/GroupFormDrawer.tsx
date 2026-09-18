import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/types'
import { Drawer } from './Drawer'
import { Toggle } from './Toggle'
import type { RuleGroup } from '../types'

export interface GroupFormValues {
  name: string
  note: string
  enabled: boolean
}

function emptyValues(): GroupFormValues {
  return { name: '', note: '', enabled: true }
}

function fromGroup(group: RuleGroup): GroupFormValues {
  return { name: group.name, note: group.note, enabled: group.enabled }
}

interface GroupFormDrawerProps {
  open: boolean
  editingGroup: RuleGroup | null
  onClose: () => void
  onSubmit: (values: GroupFormValues) => void
}

export function GroupFormDrawer({ open, editingGroup, onClose, onSubmit }: GroupFormDrawerProps) {
  const { t } = useI18n()
  return (
    <Drawer
      open={open}
      title={editingGroup ? t('drawer.group.edit.title') : t('drawer.group.add.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="group-form" className="btn-primary">
            {editingGroup ? t('drawer.group.submit.edit') : t('drawer.group.submit.add')}
          </button>
        </>
      }
    >
      {open ? (
        <GroupFormFields key={editingGroup?.id ?? 'new'} editingGroup={editingGroup} onSubmit={onSubmit} />
      ) : null}
    </Drawer>
  )
}

interface GroupFormFieldsProps {
  editingGroup: RuleGroup | null
  onSubmit: (values: GroupFormValues) => void
}

// Mounted only while the drawer is open, and remounted (via the parent's
// `key`) whenever the group being edited changes — so its form state always
// starts fresh without needing an effect to reset it.
function GroupFormFields({ editingGroup, onSubmit }: GroupFormFieldsProps) {
  const { t } = useI18n()
  const [values, setValues] = useState<GroupFormValues>(() =>
    editingGroup ? fromGroup(editingGroup) : emptyValues(),
  )
  const [errors, setErrors] = useState<{ name?: MessageKey }>({})

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (values.name.trim() === '') {
      nextErrors.name = 'validate.group.name'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    onSubmit({ ...values, name: values.name.trim() })
  }

  return (
    <form id="group-form" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="group-name" className="text-12 text-muted">
          {t('drawer.group.field.name')}
        </label>
        <input
          id="group-name"
          type="text"
          className="field-control"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'group-name-error' : undefined}
        />
        {errors.name ? (
          <p id="group-name-error" className="text-12" style={{ color: 'var(--rx-crit)' }}>
            {t(errors.name)}
          </p>
        ) : null}
      </div>

      <Toggle
        id="group-enabled"
        checked={values.enabled}
        onChange={(next) => setValues((v) => ({ ...v, enabled: next }))}
        label={t('drawer.group.field.enabled')}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="group-note" className="text-12 text-muted">
          {t('drawer.rule.field.note')}
        </label>
        <textarea
          id="group-note"
          className="field-control"
          rows={2}
          value={values.note}
          onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
        />
      </div>
    </form>
  )
}
