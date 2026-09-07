import { templates, scheduleLabel, type TemplateId } from './automation-workspace-model'

export type AutomationIcon = 'clock' | 'play' | 'pause' | 'plus' | 'trash' | 'chat' | 'search' | 'more' | 'chevron' | 'back' | 'close' | 'check' | 'failed' | 'skip' | 'channel' | 'folder' | 'code' | 'calendar' | 'document'

export function AutomationGlyph({ name }: { name: AutomationIcon }): React.JSX.Element {
  return <svg className="automation-glyph" viewBox="0 0 24 24" aria-hidden="true">
    {name === 'clock' && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5l3.4 2" /></>}
    {name === 'play' && <path d="m9 6 9 6-9 6Z" />}
    {name === 'pause' && <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 8.5v7M14.5 8.5v7" /></>}
    {name === 'plus' && <path d="M12 5v14M5 12h14" />}
    {name === 'trash' && <><path d="M5 7h14M9 7l1-3h4l1 3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>}
    {name === 'chat' && <><path d="M5 5.5h14v10H9l-4 3Z" /><path d="M8.5 9h7M8.5 12h5" /></>}
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>}
    {name === 'more' && <><circle cx="5" cy="12" r=".8" /><circle cx="12" cy="12" r=".8" /><circle cx="19" cy="12" r=".8" /></>}
    {name === 'chevron' && <path d="m8 10 4 4 4-4" />}
    {name === 'back' && <path d="m14 6-6 6 6 6" />}
    {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
    {name === 'check' && <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.8 3L16 9" /></>}
    {name === 'failed' && <><path d="m12 3 9 9-9 9-9-9Z" /><path d="m9 9 6 6M15 9l-6 6" /></>}
    {name === 'skip' && <><circle cx="12" cy="12" r="8.5" /><path d="M7.5 12h9" /></>}
    {name === 'channel' && <><path d="M5 11a7 7 0 0 1 14 0M8 11a4 4 0 0 1 8 0M12 14v6" /><circle cx="12" cy="11" r="1" /></>}
    {name === 'folder' && <path d="M3 6h7l2 3h9v11H3Z" />}
    {name === 'code' && <path d="m8 6-5 6 5 6M16 6l5 6-5 6M14 4l-4 16" />}
    {name === 'calendar' && <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h8M8 17h5" /></>}
    {name === 'document' && <><path d="M6 3h8l4 5v13H6Z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>}
  </svg>
}

export function AutomationTemplates({ onChoose, compact = false }: {
  onChoose(id?: TemplateId): void
  compact?: boolean
}): React.JSX.Element {
  return <div className={`automation-template-grid ${compact ? 'compact' : ''}`}>
    {compact && <button type="button" className="automation-template-card blank" onClick={() => onChoose()}>
      <span className="automation-template-icon"><AutomationGlyph name="plus" /></span>
      <span className="automation-template-copy"><strong>从空白开始</strong><span>自己填写执行内容与运行时间</span></span>
    </button>}
    {(Object.keys(templates) as TemplateId[]).map((id) => {
      const template = templates[id]
      return <button key={id} type="button" className={`automation-template-card ${id}`} onClick={() => onChoose(id)}>
        <span className="automation-template-icon"><AutomationGlyph name={template.icon} /></span>
        <span className="automation-template-copy"><strong>{template.name}</strong><span>{template.description}</span></span>
        <small>{scheduleLabel(template.schedule)}</small>
        <span className="automation-template-arrow"><AutomationGlyph name="back" /></span>
      </button>
    })}
  </div>
}
