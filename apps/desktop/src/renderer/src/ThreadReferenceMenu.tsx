import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { NavigationIcon } from './NavigationIcon'
import { MissionIcon } from './MissionIcon'
import { MentionRuntimeButton } from './MentionRuntimeButton'
import { ProjectFileIcon } from './ProjectFileIcon'
import { referenceProject } from './thread-reference'
import type { StructuredMentionOption } from './StructuredMentionComposer'
import { pickerOptionKey, type ReferenceFilter, type useReferencePicker } from './useReferencePicker'
import { uiAttribute } from './interface-language'
const labels = { members: '队员', file: '文件', thread: '对话', mission: '使命' }

export function ThreadReferenceMenu({ menuId, picker, inviteLayer, pendingInviteIds, selectedIndex, setHighlightedIndex, selectIndex, onFilter, renderAvatar }: {
  menuId: string; picker: ReturnType<typeof useReferencePicker>; inviteLayer: boolean; pendingInviteIds: readonly string[]
  selectedIndex: number; setHighlightedIndex(index: number): void; selectIndex(index: number): void
  onFilter(filter: ReferenceFilter): void; renderAvatar(option: StructuredMentionOption): ReactNode
}) {
  const { options, filter, loading } = picker
  const list = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const virtualized = !picker.grouped && options.length > 40 && filter !== 'members'
  const rowHeight = filter === 'file' ? 42 : 32
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3)
  const indices = virtualized ? [...new Set([...Array.from({ length: Math.min(22, options.length - start) }, (_, offset) => start + offset), selectedIndex])].filter(index => index >= 0 && index < options.length).sort((a, b) => a - b) : options.map((_, index) => index)
  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    if (virtualized) {
      const top = selectedIndex * rowHeight, bottom = top + rowHeight
      if (top < element.scrollTop) element.scrollTop = top
      else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight
    } else element.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, virtualized, rowHeight])
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = 0; setScrollTop(0) }, [filter, picker.query])
  const tabs = picker.categories
  const group = (index: number): ReferenceFilter => {
    const item = options[index]!
    return item.kind === 'file' ? 'file' : item.kind === 'reference' ? item.item.kind : 'members'
  }
  const fileError = picker.files.error === 'root_unavailable' ? '工作目录不可用' : '暂时无法读取文件'
  return <div className="mention-menu structured-mention-menu ref-menu">
    <div className="ref-menu-heading"><div className="ref-filters" role="tablist" aria-label={uiAttribute('提及类型')}>
      {tabs.map(value => <button type="button" role="tab" key={value} aria-selected={filter === value} tabIndex={filter === value || filter === 'all' && value === 'members' ? 0 : -1}
        onMouseDown={event => event.preventDefault()} onClick={() => onFilter(value)} onKeyDown={event => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
          event.preventDefault()
          const next = (tabs.indexOf(value) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
          onFilter(tabs[next]!); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
        }}>{uiAttribute(labels[value])}</button>)}
    </div></div>
    <div className="ref-options" ref={list} id={menuId} role="listbox" aria-label={uiAttribute('选择引用或队员')} aria-busy={loading} data-managed-scroll="true" data-virtualized={virtualized} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div className={virtualized ? 'ref-option-window' : undefined} style={virtualized ? { height: options.length * rowHeight } : undefined}>
      {indices.map(index => {
        const option = options[index]!
        const member = option.kind === 'member' ? option.member : null
        const item = option.kind === 'reference' ? option.item : null
        const file = option.kind === 'file' ? option.item : null
        const label = file?.name ?? item?.title ?? member?.displayName ?? uiAttribute(option.kind === 'all_members' ? '所有队员' : option.kind === 'invite_other' ? '邀请其他队员' : '返回本会话')
        const subtitle = file ? file.relativePath.split('/').slice(0, -1).join('/') || './' : item ? referenceProject(item) : member?.teamRole ?? uiAttribute(option.kind === 'all_members' ? '广播给当前全部队员' : option.kind === 'invite_other' ? '浏览其他可用队员' : '查看当前会话队员')
        return <div key={pickerOptionKey(option)} className="ref-option-wrap" style={virtualized ? { position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight } : undefined}>
          {picker.grouped && (index === 0 || group(index - 1) !== group(index)) && <div className="ref-group-label">{uiAttribute(labels[group(index)])}</div>}
          <button type="button" role="option" tabIndex={-1} id={`${menuId}-option-${index}`} aria-posinset={index + 1} aria-setsize={picker.hasMore ? -1 : options.length} aria-selected={selectedIndex === index}
            data-option-kind={option.kind} data-reference-id={item?.id} data-agent-id={member?.agentId} aria-label={file ? `${file.name}，${file.relativePath}` : `${label}，${subtitle}`} title={file?.relativePath ?? (item ? `${label}\n${subtitle}` : undefined)}
            className={[selectedIndex === index ? 'active' : '', item || file ? 'ref-thread-option' : '', file ? 'ref-file-option' : '', member?.runtimeLabel ? 'has-runtime' : '', member?.inThread === false ? 'is-invitable' : '', option.kind === 'invite_other' || option.kind === 'back_to_camp' ? 'is-mention-action' : ''].join(' ')}
            onMouseMove={() => setHighlightedIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => selectIndex(index)}>
            {file || item ? <><span className="ref-candidate-icon">{file ? <ProjectFileIcon fileName={file.name} /> : item?.kind === 'mission' ? <MissionIcon /> : <NavigationIcon name="messages" />}</span><strong className="ref-candidate-title">{label}</strong><small className="ref-candidate-project">{subtitle}</small></>
              : <>{option.kind !== 'reference' && option.kind !== 'file' && renderAvatar(option)}<span><strong>{label}</strong><small>{subtitle}</small></span></>}
            {member?.inThread === false && <span className="mention-option-state">{uiAttribute(pendingInviteIds.includes(member.agentId) ? '待邀请' : '邀请')}</span>}
          </button>
          {member?.runtimeLabel && <div className="ref-runtime" style={picker.grouped && (index === 0 || group(index - 1) !== group(index)) ? { top: 22 } : undefined}><MentionRuntimeButton kind={member.runtimeKind} label={member.runtimeLabel} model={member.modelLabel} memberName={member.displayName} onHighlight={() => setHighlightedIndex(index)} onSelect={() => selectIndex(index)} /></div>}
        </div>
      })}</div>
      {!options.length && !loading && <p className="structured-mention-empty">{uiAttribute(filter === 'file' ? !picker.hasProject ? '当前对话未关联项目' : picker.files.error ? fileError : picker.files.partial ? '结果可能不完整，请缩小范围' : picker.query ? '无匹配文件' : '输入文件名或路径' : picker.grouped && picker.files.partial ? '文件结果可能不完整，请缩小范围' : picker.grouped && picker.files.error ? fileError : picker.status === 'error' ? '暂时无法读取' : '无匹配结果')}</p>}
      {loading && <p className="ref-search-state" role="status">{uiAttribute('搜索中…')}</p>}
    </div>
    {(filter === 'file' || picker.grouped) && picker.files.partial && !!options.length && <p className="ref-source-note">{uiAttribute('文件结果可能不完整，请缩小范围')}</p>}
    {(filter === 'file' || picker.grouped) && picker.files.error && !!options.length && <p className="ref-source-note">{uiAttribute(fileError)}</p>}
    {picker.sourceErrors.map(kind => <p className="ref-source-note" key={kind}>{uiAttribute(`${labels[kind]}暂时无法读取`)}</p>)}
    {(picker.status === 'error' || picker.files.error || picker.sourceErrors.length > 0) && <button type="button" className="ref-load-more" onMouseDown={event => event.preventDefault()} onClick={picker.retry}>{uiAttribute('重试')}</button>}
    {!inviteLayer && picker.hasMore && <button type="button" className="ref-load-more" disabled={picker.status === 'more'} onMouseDown={event => event.preventDefault()} onClick={() => { void picker.more() }}>{uiAttribute(picker.status === 'more' ? '加载中…' : '加载更多')}</button>}
  </div>
}
