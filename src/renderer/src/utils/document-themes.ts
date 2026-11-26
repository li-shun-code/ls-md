import { BUILT_IN_DOCUMENT_THEME_OPTIONS, normalizeDocumentThemeId } from '../../../shared/document-theme-options'

export type BuiltInDocumentTheme = {
  id: string
  name: string
  description: string
  swatches: string[]
  css: string
}

const THEME_STYLES: Record<string, string> = {
  github: `
:scope:scope, :scope:scope .tiptap-editor {
  color: #24292f;
  background: #ffffff;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  line-height: 1.75;
}
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2,
:scope:scope h3, :scope:scope .tiptap-editor h3,
:scope:scope h4, :scope:scope .tiptap-editor h4,
:scope:scope h5, :scope:scope .tiptap-editor h5,
:scope:scope h6, :scope:scope .tiptap-editor h6 { color: #24292f; line-height: 1.35; }
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2 { padding-bottom: .35em; border-bottom: 1px solid #d0d7de; }
:scope:scope p, :scope:scope .tiptap-editor p { color: #24292f; }
:scope:scope a, :scope:scope .tiptap-editor a { color: #0969da; }
:scope:scope blockquote, :scope:scope .tiptap-editor blockquote { border-left: 4px solid #d0d7de; color: #57606a; background: #f6f8fa; }
:scope:scope code, :scope:scope .tiptap-editor code { color: #24292f; background: #f6f8fa; }
:scope:scope pre, :scope:scope .tiptap-editor pre { border: 1px solid #d0d7de; border-radius: 7px; color: #24292f; background: #f6f8fa; }
:scope:scope th, :scope:scope .tiptap-editor th { background: #f6f8fa; }
:scope:scope th, :scope:scope .tiptap-editor th,
:scope:scope td, :scope:scope .tiptap-editor td { border: 1px solid #d0d7de; }
`,
  newsprint: `
:scope:scope, :scope:scope .tiptap-editor {
  color: #302b25;
  background: #f7f3e9;
  font-family: Georgia, "Songti SC", serif;
  line-height: 1.9;
}
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2,
:scope:scope h3, :scope:scope .tiptap-editor h3,
:scope:scope h4, :scope:scope .tiptap-editor h4,
:scope:scope h5, :scope:scope .tiptap-editor h5,
:scope:scope h6, :scope:scope .tiptap-editor h6 { color: #332a22; font-family: Georgia, "Songti SC", serif; }
:scope:scope h1, :scope:scope .tiptap-editor h1 { padding-bottom: .35em; border-bottom: 2px solid #6f6251; text-align: center; }
:scope:scope p, :scope:scope .tiptap-editor p { color: #302b25; }
:scope:scope a, :scope:scope .tiptap-editor a { color: #8b4e32; }
:scope:scope blockquote, :scope:scope .tiptap-editor blockquote { border-left: 0; color: #6b6257; background: #eee8da; font-style: italic; }
:scope:scope code, :scope:scope .tiptap-editor code { color: #5d3c2b; background: #eee8da; }
:scope:scope pre, :scope:scope .tiptap-editor pre { border: 1px solid #d9cfbd; color: #383129; background: #eee8da; }
:scope:scope th, :scope:scope .tiptap-editor th,
:scope:scope td, :scope:scope .tiptap-editor td { border-bottom: 1px solid #d6cbb8; }
:scope:scope th, :scope:scope .tiptap-editor th { background: #eee8da; }
`,
  night: `
:scope:scope, :scope:scope .tiptap-editor {
  color: #d5d9e0;
  background: #282c34;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  line-height: 1.8;
  color-scheme: dark;
}
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2,
:scope:scope h3, :scope:scope .tiptap-editor h3,
:scope:scope h4, :scope:scope .tiptap-editor h4,
:scope:scope h5, :scope:scope .tiptap-editor h5,
:scope:scope h6, :scope:scope .tiptap-editor h6 { color: #eef0f4; }
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2 { border-bottom: 1px solid #454b57; }
:scope:scope p, :scope:scope .tiptap-editor p { color: #d5d9e0; }
:scope:scope a, :scope:scope .tiptap-editor a { color: #8cc8ff; }
:scope:scope blockquote, :scope:scope .tiptap-editor blockquote { border-left: 4px solid #6f7785; color: #bdc5d2; background: #323743; }
:scope:scope code, :scope:scope .tiptap-editor code { color: #f0c987; background: #343a46; }
:scope:scope pre, :scope:scope .tiptap-editor pre { border: 1px solid #454b57; color: #e6edf3; background: #20232a; }
:scope:scope th, :scope:scope .tiptap-editor th,
:scope:scope td, :scope:scope .tiptap-editor td { border: 1px solid #454b57; }
:scope:scope th, :scope:scope .tiptap-editor th { background: #323743; }
`,
  pixyll: `
:scope:scope, :scope:scope .tiptap-editor {
  color: #333333;
  background: #ffffff;
  font-family: Georgia, "Songti SC", serif;
  line-height: 1.85;
}
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2,
:scope:scope h3, :scope:scope .tiptap-editor h3,
:scope:scope h4, :scope:scope .tiptap-editor h4,
:scope:scope h5, :scope:scope .tiptap-editor h5,
:scope:scope h6, :scope:scope .tiptap-editor h6 { color: #111111; font-family: Arial, "Microsoft YaHei", sans-serif; font-weight: 800; line-height: 1.25; }
:scope:scope h1, :scope:scope .tiptap-editor h1 { font-size: 2.4em; }
:scope:scope h2, :scope:scope .tiptap-editor h2 { border-bottom: 0; font-size: 1.75em; }
:scope:scope p, :scope:scope .tiptap-editor p { color: #333333; }
:scope:scope a, :scope:scope .tiptap-editor a { color: #0086b3; }
:scope:scope blockquote, :scope:scope .tiptap-editor blockquote { border-left: 4px solid #dfe2e5; color: #666666; background: #f8f8f8; }
:scope:scope code, :scope:scope .tiptap-editor code { color: #c7254e; background: #f9f2f4; }
:scope:scope pre, :scope:scope .tiptap-editor pre { border: 1px solid #e3e3e3; color: #333333; background: #f7f7f7; }
:scope:scope th, :scope:scope .tiptap-editor th,
:scope:scope td, :scope:scope .tiptap-editor td { border-bottom: 1px solid #dddddd; }
:scope:scope th, :scope:scope .tiptap-editor th { background: #f7f7f7; }
`,
  gothic: `
:scope:scope, :scope:scope .tiptap-editor {
  color: #292b30;
  background: #ffffff;
  font-family: "Arial", "Microsoft YaHei", sans-serif;
  line-height: 1.8;
}
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2,
:scope:scope h3, :scope:scope .tiptap-editor h3,
:scope:scope h4, :scope:scope .tiptap-editor h4,
:scope:scope h5, :scope:scope .tiptap-editor h5,
:scope:scope h6, :scope:scope .tiptap-editor h6 {
  color: #252a32;
  font-family: "Arial", "Microsoft YaHei", sans-serif;
  font-weight: 700;
  letter-spacing: .045em;
  text-align: center;
  text-transform: uppercase;
}
:scope:scope h1, :scope:scope .tiptap-editor h1 { padding-bottom: .45em; border-bottom: 1px solid #d7dbe2; }
:scope:scope h2, :scope:scope .tiptap-editor h2 { border-bottom: 0; }
:scope:scope p, :scope:scope .tiptap-editor p { color: #42464d; }
:scope:scope a, :scope:scope .tiptap-editor a { color: #526b91; }
:scope:scope blockquote, :scope:scope .tiptap-editor blockquote { border-left: 3px solid #8795aa; color: #5c626c; background: #f4f5f7; }
:scope:scope code, :scope:scope .tiptap-editor code { color: #384d6c; background: #f0f2f5; }
:scope:scope pre, :scope:scope .tiptap-editor pre { border: 1px solid #d7dbe2; color: #30343b; background: #f3f4f6; }
:scope:scope th, :scope:scope .tiptap-editor th,
:scope:scope td, :scope:scope .tiptap-editor td { border: 1px solid #d7dbe2; }
:scope:scope th, :scope:scope .tiptap-editor th { background: #f0f2f5; }
`,
  whitey: `
:scope:scope, :scope:scope .tiptap-editor {
  color: #333333;
  background: #ffffff;
  font-family: "Palatino Linotype", Palatino, "Songti SC", serif;
  line-height: 1.85;
}
:scope:scope h1, :scope:scope .tiptap-editor h1,
:scope:scope h2, :scope:scope .tiptap-editor h2,
:scope:scope h3, :scope:scope .tiptap-editor h3,
:scope:scope h4, :scope:scope .tiptap-editor h4,
:scope:scope h5, :scope:scope .tiptap-editor h5,
:scope:scope h6, :scope:scope .tiptap-editor h6 { color: #292929; font-family: "Palatino Linotype", Palatino, "Songti SC", serif; font-weight: 500; text-align: center; }
:scope:scope h1, :scope:scope .tiptap-editor h1 { padding-bottom: .45em; border-bottom: 1px solid #d9d9d9; }
:scope:scope h2, :scope:scope .tiptap-editor h2 { border-bottom: 0; }
:scope:scope p, :scope:scope .tiptap-editor p { color: #333333; text-align: justify; }
:scope:scope a, :scope:scope .tiptap-editor a { color: #3d6590; }
:scope:scope blockquote, :scope:scope .tiptap-editor blockquote { border-left: 3px solid #b8b8b8; color: #666666; background: #f7f7f7; font-style: italic; }
:scope:scope code, :scope:scope .tiptap-editor code { color: #444444; background: #f1f1f1; }
:scope:scope pre, :scope:scope .tiptap-editor pre { border: 1px solid #dedede; color: #333333; background: #f6f6f6; }
:scope:scope th, :scope:scope .tiptap-editor th,
:scope:scope td, :scope:scope .tiptap-editor td { border: 1px solid #dedede; }
:scope:scope th, :scope:scope .tiptap-editor th { background: #f5f5f5; }
`,
}

const THEME_DETAILS: Record<string, { description: string; swatches: string[] }> = {
  github: { description: 'GitHub 文档风格', swatches: ['#ffffff', '#24292f', '#0969da'] },
  newsprint: { description: '暖纸色与报刊衬线字', swatches: ['#f7f3e9', '#302b25', '#8b4e32'] },
  night: { description: '深色低光阅读', swatches: ['#282c34', '#d5d9e0', '#8cc8ff'] },
  pixyll: { description: '大标题与轻盈长文排版', swatches: ['#ffffff', '#333333', '#0086b3'] },
  gothic: { description: '居中大写标题与清晰层次', swatches: ['#ffffff', '#292b30', '#526b91'] },
  whitey: { description: '书页白与居中衬线标题', swatches: ['#ffffff', '#333333', '#3d6590'] },
}

export const BUILT_IN_DOCUMENT_THEMES: BuiltInDocumentTheme[] = BUILT_IN_DOCUMENT_THEME_OPTIONS.map((theme) => ({
  ...theme,
  ...THEME_DETAILS[theme.id],
  css: THEME_STYLES[theme.id],
}))

export const DEFAULT_DOCUMENT_THEME_ID = BUILT_IN_DOCUMENT_THEMES[0].id

export function getBuiltInDocumentTheme(themeId: string): BuiltInDocumentTheme | undefined {
  const normalizedId = normalizeDocumentThemeId(themeId)
  return BUILT_IN_DOCUMENT_THEMES.find((theme) => theme.id === normalizedId)
}

export function scopeDocumentThemeCss(css: string, scope = '.mojian-document'): string {
  const cssWithThemeSpecificity = css.replace(/:scope\b/g, ':scope:scope')
  return `@scope (${scope}) {\n${cssWithThemeSpecificity}\n}`
}
