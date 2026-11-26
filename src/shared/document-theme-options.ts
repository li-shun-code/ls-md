import type { DocumentThemeSummary } from './types'

export const BUILT_IN_DOCUMENT_THEME_OPTIONS = [
  { id: 'github', name: 'GitHub' },
  { id: 'gothic', name: 'Gothic' },
  { id: 'newsprint', name: 'Newsprint' },
  { id: 'night', name: 'Night' },
  { id: 'pixyll', name: 'Pixyll' },
  { id: 'whitey', name: 'Whitey' },
] satisfies DocumentThemeSummary[]

const LEGACY_THEME_IDS: Record<string, string> = {
  'classic-light': 'github',
  paper: 'newsprint',
  'warm-amber': 'newsprint',
  'academic-blue': 'pixyll',
  midnight: 'night',
}

export function normalizeDocumentThemeId(themeId: string): string {
  return LEGACY_THEME_IDS[themeId] ?? themeId
}
