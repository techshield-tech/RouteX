import { useState } from 'react'
import { useConfigStore } from '../state/configContext'
import { useI18n } from '../i18n/context'
import { matchTypeKey, matchTypeOrder } from '../i18n/enumKeys'
import { PageHeader } from '../components/PageHeader'
import { SearchInput } from '../components/SearchInput'
import { Select } from '../components/Select'
import { DataTable } from '../components/DataTable'
import { Chip } from '../components/Chip'
import { Toggle } from '../components/Toggle'
import { Icon } from '../components/Icon'
import { ConfirmInline } from '../components/ConfirmInline'
import { EmptyState } from '../components/EmptyState'
import { TemplateFormDrawer, type TemplateFormValues } from '../components/TemplateFormDrawer'
import { GroupFormDrawer, type GroupFormValues } from '../components/GroupFormDrawer'
import type { MatchType, RuleGroup, RuleTemplate } from '../types'

export function Templates() {
  const { t } = useI18n()
  const {
    ruleTemplates,
    ruleGroups,
    addRuleTemplate,
    updateRuleTemplate,
    removeRuleTemplate,
    duplicateRuleTemplate,
    moveRuleTemplate,
    toggleRuleTemplateEnabled,
    addRuleGroup,
    updateRuleGroup,
    removeRuleGroup,
    toggleRuleGroupEnabled,
    templatesForGroup,
    templateCountForGroup,
    routeEntryCountForTarget,
  } = useConfigStore()

  const [query, setQuery] = useState('')
  const [matchFilter, setMatchFilter] = useState<'all' | MatchType>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<RuleTemplate | null>(null)
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<RuleGroup | null>(null)
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null)
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null)

  function matchesFilters(tpl: RuleTemplate) {
    const q = query.trim().toLowerCase()
    if (matchFilter !== 'all' && tpl.matchType !== matchFilter) return false
    if (q && !tpl.name.toLowerCase().includes(q) && !tpl.pattern.toLowerCase().includes(q)) return false
    return true
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openAddTemplate() {
    setEditingTemplate(null)
    setTemplateDrawerOpen(true)
  }
  function openEditTemplate(tpl: RuleTemplate) {
    setEditingTemplate(tpl)
    setTemplateDrawerOpen(true)
  }
  function handleTemplateSubmit(values: TemplateFormValues) {
    if (editingTemplate) {
      if (values.groupId !== editingTemplate.groupId) {
        const groupName = values.groupId
          ? (ruleGroups.find((g) => g.id === values.groupId)?.name ?? values.groupId)
          : t('templates.ungrouped')
        updateRuleTemplate(editingTemplate.id, values, {
          key: 'change.template.movedGroup',
          params: { name: values.name, group: groupName },
        })
      } else {
        updateRuleTemplate(editingTemplate.id, values, {
          key: 'change.template.edited',
          params: { name: values.name },
        })
      }
    } else {
      addRuleTemplate(values)
    }
    setTemplateDrawerOpen(false)
  }

  function openAddGroup() {
    setEditingGroup(null)
    setGroupDrawerOpen(true)
  }
  function openEditGroup(group: RuleGroup) {
    setEditingGroup(group)
    setGroupDrawerOpen(true)
  }
  function handleGroupSubmit(values: GroupFormValues) {
    if (editingGroup) {
      updateRuleGroup(editingGroup.id, values, { key: 'change.group.edited', params: { name: values.name } })
    } else {
      addRuleGroup(values)
    }
    setGroupDrawerOpen(false)
  }

  const searchActive = query.trim() !== '' || matchFilter !== 'all'
  const showGroup = (id: string) => groupFilter === 'all' || groupFilter === id
  const showStandalone = groupFilter === 'all' || groupFilter === 'none'

  const visibleGroups = ruleGroups.filter(
    (g) => showGroup(g.id) && (!searchActive || templatesForGroup(g.id).some(matchesFilters)),
  )
  const standaloneAll = templatesForGroup(null)
  const standaloneVisible = standaloneAll.filter(matchesFilters)
  const showStandaloneSection = showStandalone && (!searchActive || standaloneVisible.length > 0)

  const isLibraryEmpty = ruleTemplates.length === 0 && ruleGroups.length === 0
  const nothingMatches = !isLibraryEmpty && visibleGroups.length === 0 && !showStandaloneSection

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('templates.title')}
        description={t('templates.description')}
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={openAddGroup}>
              <Icon name="plus" />
              {t('templates.addGroup')}
            </button>
            <button type="button" className="btn-primary" onClick={openAddTemplate}>
              <Icon name="plus" />
              {t('templates.add')}
            </button>
          </div>
        }
      />

      {isLibraryEmpty ? (
        <EmptyState message={t('templates.empty.none')} actionLabel={t('templates.add')} onAction={openAddTemplate} />
      ) : (
        <>
          <div className="flex flex-col gap-3 nav:flex-row nav:items-end nav:flex-wrap">
            <div className="nav:w-64">
              <SearchInput
                id="templates-search"
                label={t('templates.search.label')}
                value={query}
                onChange={setQuery}
                placeholder={t('templates.search.placeholder')}
              />
            </div>
            <Select
              id="templates-match-filter"
              label={t('templates.filter.matchType')}
              value={matchFilter}
              onChange={(e) => setMatchFilter(e.target.value as typeof matchFilter)}
            >
              <option value="all">{t('templates.filter.matchType.all')}</option>
              {matchTypeOrder.map((value) => (
                <option key={value} value={value}>
                  {t(matchTypeKey[value])}
                </option>
              ))}
            </Select>
            <Select
              id="templates-group-filter"
              label={t('templates.filter.group')}
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="all">{t('templates.filter.group.all')}</option>
              {ruleGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value="none">{t('templates.ungrouped')}</option>
            </Select>
          </div>

          {nothingMatches ? (
            <EmptyState message={t('templates.empty.filtered')} />
          ) : (
            <div className="flex flex-col gap-4">
              {visibleGroups.map((group) => {
                const fullList = templatesForGroup(group.id)
                const rows = searchActive ? fullList.filter(matchesFilters) : fullList
                const isCollapsed = collapsed.has(group.id)
                const routeCount = routeEntryCountForTarget('group', group.id)
                return (
                  <section key={group.id} className="rounded border border-line bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        aria-expanded={!isCollapsed}
                        aria-controls={`group-body-${group.id}`}
                        onClick={() => toggleCollapsed(group.id)}
                      >
                        <Icon name={isCollapsed ? 'chevron-down' : 'chevron-up'} className="shrink-0 text-muted" />
                        <span className="truncate text-14 font-medium text-text">{group.name}</span>
                        <span className="shrink-0 text-12 text-muted">
                          {t('templates.group.summary', {
                            templateCount: fullList.length,
                            routeCount,
                          })}
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        <Toggle
                          id={`group-enabled-${group.id}`}
                          checked={group.enabled}
                          onChange={() => toggleRuleGroupEnabled(group.id)}
                          label={t(group.enabled ? 'templates.group.disable' : 'templates.group.enable', {
                            name: group.name,
                          })}
                          hideLabel
                        />
                        {confirmDeleteGroupId === group.id ? (
                          <ConfirmInline
                            message={t('templates.confirm.deleteGroup', {
                              name: group.name,
                              templateCount: templateCountForGroup(group.id),
                              routeCount,
                            })}
                            onCancel={() => setConfirmDeleteGroupId(null)}
                            onConfirm={() => {
                              removeRuleGroup(group.id, {
                                key: 'change.group.deleted',
                                params: {
                                  name: group.name,
                                  templateCount: templateCountForGroup(group.id),
                                  routeCount,
                                },
                              })
                              setConfirmDeleteGroupId(null)
                            }}
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('templates.group.edit', { name: group.name })}
                              onClick={() => openEditGroup(group)}
                            >
                              <Icon name="edit" />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('templates.group.delete', { name: group.name })}
                              onClick={() => setConfirmDeleteGroupId(group.id)}
                            >
                              <Icon name="delete" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isCollapsed ? null : (
                      <div id={`group-body-${group.id}`} className="border-t border-line p-3">
                        {rows.length === 0 ? (
                          <p className="px-1 py-2 text-13 text-muted">{t('templates.empty.filtered')}</p>
                        ) : (
                          <TemplateRows
                            rows={rows}
                            fullList={fullList}
                            onEdit={openEditTemplate}
                            onDuplicate={duplicateRuleTemplate}
                            onMove={moveRuleTemplate}
                            onToggle={toggleRuleTemplateEnabled}
                            onDelete={removeRuleTemplate}
                            routeEntryCountForTarget={routeEntryCountForTarget}
                            confirmDeleteId={confirmDeleteTemplateId}
                            setConfirmDeleteId={setConfirmDeleteTemplateId}
                          />
                        )}
                      </div>
                    )}
                  </section>
                )
              })}

              {showStandaloneSection ? (
                <section className="rounded border border-line bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="text-14 font-medium text-text">{t('templates.ungrouped')}</span>
                    <span className="text-12 text-muted">
                      {t('templates.group.summaryStandalone', { templateCount: standaloneAll.length })}
                    </span>
                  </div>
                  <div className="border-t border-line p-3">
                    {(searchActive ? standaloneVisible : standaloneAll).length === 0 ? (
                      <p className="px-1 py-2 text-13 text-muted">{t('templates.empty.filtered')}</p>
                    ) : (
                      <TemplateRows
                        rows={searchActive ? standaloneVisible : standaloneAll}
                        fullList={standaloneAll}
                        onEdit={openEditTemplate}
                        onDuplicate={duplicateRuleTemplate}
                        onMove={moveRuleTemplate}
                        onToggle={toggleRuleTemplateEnabled}
                        onDelete={removeRuleTemplate}
                        routeEntryCountForTarget={routeEntryCountForTarget}
                        confirmDeleteId={confirmDeleteTemplateId}
                        setConfirmDeleteId={setConfirmDeleteTemplateId}
                      />
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}

      <TemplateFormDrawer
        open={templateDrawerOpen}
        editingTemplate={editingTemplate}
        groups={ruleGroups}
        defaultGroupId={editingTemplate ? editingTemplate.groupId : null}
        onClose={() => setTemplateDrawerOpen(false)}
        onSubmit={handleTemplateSubmit}
      />
      <GroupFormDrawer
        open={groupDrawerOpen}
        editingGroup={editingGroup}
        onClose={() => setGroupDrawerOpen(false)}
        onSubmit={handleGroupSubmit}
      />
    </div>
  )
}

interface TemplateRowsProps {
  rows: RuleTemplate[]
  fullList: RuleTemplate[]
  onEdit: (tpl: RuleTemplate) => void
  onDuplicate: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onToggle: (id: string) => void
  onDelete: (id: string, change: { key: 'change.template.deleted'; params: { name: string; count: number } }) => void
  routeEntryCountForTarget: (kind: 'template' | 'group', id: string) => number
  confirmDeleteId: string | null
  setConfirmDeleteId: (id: string | null) => void
}

/** Shared table body for a group's templates or the standalone section. */
function TemplateRows({
  rows,
  fullList,
  onEdit,
  onDuplicate,
  onMove,
  onToggle,
  onDelete,
  routeEntryCountForTarget,
  confirmDeleteId,
  setConfirmDeleteId,
}: TemplateRowsProps) {
  const { t } = useI18n()
  return (
    <DataTable>
      <thead>
        <tr>
          <th scope="col">{t('templates.col.priority')}</th>
          <th scope="col">{t('templates.col.name')}</th>
          <th scope="col">{t('templates.col.match')}</th>
          <th scope="col" className="text-right">
            {t('templates.col.routeCount')}
          </th>
          <th scope="col">{t('templates.col.enabled')}</th>
          <th scope="col">
            <span className="sr-only">{t('templates.col.rowActions')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((tpl) => {
          const subsetIndex = fullList.findIndex((t2) => t2.id === tpl.id)
          const routeCount = routeEntryCountForTarget('template', tpl.id)
          return (
            <tr key={tpl.id} className={tpl.enabled ? '' : 'is-disabled'}>
              <td className="font-mono tabular-nums text-muted">{subsetIndex + 1}</td>
              <td className="text-text">{tpl.name}</td>
              <td>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip label={t(matchTypeKey[tpl.matchType])} />
                  <span className="font-mono text-12 text-muted">{tpl.pattern}</span>
                </div>
              </td>
              <td className="text-right font-mono tabular-nums">{routeCount}</td>
              <td>
                <Toggle
                  id={`template-enabled-${tpl.id}`}
                  checked={tpl.enabled}
                  onChange={() => onToggle(tpl.id)}
                  label={t(tpl.enabled ? 'templates.row.disable' : 'templates.row.enable', { name: tpl.name })}
                  hideLabel
                />
              </td>
              <td>
                {confirmDeleteId === tpl.id ? (
                  <ConfirmInline
                    message={t('templates.confirm.delete', { name: tpl.name, count: routeCount })}
                    onCancel={() => setConfirmDeleteId(null)}
                    onConfirm={() => {
                      onDelete(tpl.id, { key: 'change.template.deleted', params: { name: tpl.name, count: routeCount } })
                      setConfirmDeleteId(null)
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('templates.row.moveUp', { name: tpl.name })}
                      disabled={subsetIndex === 0}
                      onClick={() => onMove(tpl.id, 'up')}
                    >
                      <Icon name="chevron-up" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('templates.row.moveDown', { name: tpl.name })}
                      disabled={subsetIndex === fullList.length - 1}
                      onClick={() => onMove(tpl.id, 'down')}
                    >
                      <Icon name="chevron-down" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('templates.row.edit', { name: tpl.name })}
                      onClick={() => onEdit(tpl)}
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('templates.row.duplicate', { name: tpl.name })}
                      onClick={() => onDuplicate(tpl.id)}
                    >
                      <Icon name="duplicate" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('templates.row.delete', { name: tpl.name })}
                      onClick={() => setConfirmDeleteId(tpl.id)}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </DataTable>
  )
}
