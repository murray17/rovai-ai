import type {
  WindowsApplicationMenuPopupRequest,
  WindowsApplicationMenuSection
} from '@contracts'
import type { Menu } from 'electron'

const MENU_SECTIONS = new Set<WindowsApplicationMenuSection>([
  'file',
  'edit',
  'view',
  'window'
])

const MENU_SECTION_ROLES: Record<WindowsApplicationMenuSection, string> = {
  file: 'fileMenu',
  edit: 'editMenu',
  view: 'viewMenu',
  window: 'windowMenu'
}

function isMenuSection(value: unknown): value is WindowsApplicationMenuSection {
  return typeof value === 'string'
    && MENU_SECTIONS.has(value as WindowsApplicationMenuSection)
}

export function parseWindowsApplicationMenuPopupRequest(
  value: unknown
): WindowsApplicationMenuPopupRequest | null {
  if (!value || typeof value !== 'object') return null
  const request = value as Partial<WindowsApplicationMenuPopupRequest>
  if (
    !isMenuSection(request.section)
    || typeof request.x !== 'number'
    || !Number.isFinite(request.x)
    || typeof request.y !== 'number'
    || !Number.isFinite(request.y)
    || (request.sourceType !== 'mouse' && request.sourceType !== 'keyboard')
  ) return null

  return {
    section: request.section,
    x: Math.round(request.x),
    y: Math.round(request.y),
    sourceType: request.sourceType
  }
}

function normalizedMenuLabel(label: string): string {
  return label.replaceAll('&', '').trim().toLocaleLowerCase('en-US')
}

export function windowsApplicationSubmenu(
  applicationMenu: Pick<Menu, 'items'> | null,
  section: WindowsApplicationMenuSection
): Menu | null {
  if (!applicationMenu) return null
  const expectedRole = MENU_SECTION_ROLES[section]
  const item = applicationMenu.items.find((candidate) => (
    candidate.role === expectedRole
    || normalizedMenuLabel(candidate.label) === section
  ))
  return item?.submenu ?? null
}

export function prepareWindowsApplicationMenu(
  applicationMenu: Pick<Menu, 'items'> | null
): void {
  if (!applicationMenu) return
  for (const item of applicationMenu.items) {
    if (
      !Object.values(MENU_SECTION_ROLES).includes(item.role ?? '')
      && !isMenuSection(normalizedMenuLabel(item.label))
    ) continue
    item.label = item.label.replaceAll('&', '')
  }
}
