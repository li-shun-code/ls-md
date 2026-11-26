export type BuiltInDocumentTheme = {
  id: string
  name: string
  description: string
  swatches: string[]
  css: string
}

export const BUILT_IN_DOCUMENT_THEMES: BuiltInDocumentTheme[] = [
  {
    id: 'classic-light',
    name: '简洁白',
    description: '清爽留白 · GitHub 文档感',
    swatches: ['#ffffff', '#24292f', '#0969da'],
    css: `:scope {
  color: #24292f;
  background-color: #ffffff;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  line-height: 1.8;
}
:scope .tiptap-editor { color: #24292f; }
:scope h1, :scope h2, :scope h3, :scope h4, :scope h5, :scope h6 { color: #24292f; line-height: 1.4; }
:scope h1, :scope h2 { padding-bottom: .35em; border-bottom: 1px solid #d0d7de; }
:scope a { color: #0969da; }
:scope blockquote { padding: .6em 1em; border-left: 3px solid #d0d7de; color: #57606a; background: #f6f8fa; }
:scope code { border-radius: 4px; background: #f6f8fa; }
:scope pre { padding: 1em 1.2em; border: 1px solid #d0d7de; border-radius: 7px; color: #24292f; background: #f6f8fa; }
:scope table { border-collapse: collapse; }
:scope th { background: #f6f8fa; }
:scope th, :scope td { border: 1px solid #d0d7de; }`,
  },
  {
    id: 'paper',
    name: '纸本',
    description: '电子纸感 · 安静阅读',
    swatches: ['#fdfbf7', '#1a1a1a', '#6b705c'],
    css: `:scope {
  color: #1a1a1a;
  background-color: #fdfbf7;
  font-family: Georgia, "Songti SC", serif;
  line-height: 1.9;
}
:scope .tiptap-editor { color: #1a1a1a; }
:scope h1, :scope h2, :scope h3, :scope h4, :scope h5, :scope h6 { color: #1a1a1a; font-family: Georgia, "Songti SC", serif; line-height: 1.4; }
:scope h1 { padding-bottom: .4em; border-bottom: 1px solid #e0ddd5; }
:scope a { color: #566b56; text-decoration-thickness: 1px; }
:scope blockquote { padding: .6em 1em; border-left: 3px solid #9b9b7a; color: #4a4a4a; background: #f5f2ea; }
:scope pre { padding: 1em 1.2em; border: 1px solid #e0ddd5; border-radius: 5px; color: #292923; background: #f5f2ea; }
:scope th, :scope td { border-bottom: 1px solid #d8d4ca; }`,
  },
  {
    id: 'warm-amber',
    name: '暖棕',
    description: '暖纸色 · 琥珀强调',
    swatches: ['#fffbeb', '#0f172a', '#d97706'],
    css: `:scope {
  color: #0f172a;
  background-color: #fffbeb;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  line-height: 1.8;
}
:scope .tiptap-editor { color: #0f172a; }
:scope h1, :scope h2, :scope h3, :scope h4, :scope h5, :scope h6 { color: #78350f; }
:scope h1, :scope h2 { border-bottom: 1px solid #f1e8e2; }
:scope a { color: #92400e; }
:scope blockquote { padding: .6em 1em; border-left: 3px solid #d97706; color: #78350f; background: #f8f3f0; }
:scope code { color: #78350f; background: #f6ead7; }
:scope pre { padding: 1em 1.2em; border-radius: 7px; color: #fef3c7; background: #3b2f28; }
:scope th, :scope td { border: 1px solid #e7d8c4; }
:scope th { background: #f8f3f0; }`,
  },
  {
    id: 'academic-blue',
    name: '学术蓝',
    description: '论文排版 · 海军蓝与引文金',
    swatches: ['#f8fafc', '#1e3a5f', '#b45309'],
    css: `:scope {
  color: #0f172a;
  background-color: #f8fafc;
  font-family: Georgia, "Songti SC", serif;
  line-height: 1.85;
}
:scope .tiptap-editor { color: #0f172a; }
:scope h1, :scope h2, :scope h3, :scope h4, :scope h5, :scope h6 { color: #1e3a5f; font-family: Georgia, "Songti SC", serif; }
:scope h1, :scope h2 { border-bottom: 1px solid #cbd5e1; }
:scope a { color: #1d4ed8; }
:scope blockquote { padding: .6em 1em; border-left: 3px solid #b45309; color: #334155; background: #e9eef5; }
:scope code { color: #1e3a5f; background: #e9eef5; }
:scope pre { padding: 1em 1.2em; border: 1px solid #cbd5e1; color: #0f172a; background: #e9eef5; }
:scope th, :scope td { border: 1px solid #cbd5e1; }
:scope th { background: #e9eef5; }`,
  },
  {
    id: 'midnight',
    name: '午夜',
    description: '低光环境 · OLED 墨色',
    swatches: ['#121212', '#e0e0e0', '#8ab4f8'],
    css: `:scope {
  color: #e0e0e0;
  background-color: #121212;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  line-height: 1.8;
  color-scheme: dark;
}
:scope .tiptap-editor { color: #e0e0e0; }
:scope h1, :scope h2, :scope h3, :scope h4, :scope h5, :scope h6 { color: #f0f3f8; }
:scope h1, :scope h2 { border-bottom: 1px solid #30343b; }
:scope a { color: #8ab4f8; }
:scope blockquote { padding: .6em 1em; border-left: 3px solid #8ab4f8; color: #c1c9d4; background: #1d222a; }
:scope code { color: #d8dee9; background: #20252e; }
:scope pre { padding: 1em 1.2em; border: 1px solid #30343b; border-radius: 7px; color: #e6edf3; background: #0d1117; }
:scope th, :scope td { border: 1px solid #30343b; }
:scope th { background: #1d222a; }`,
  },
]

export const DEFAULT_DOCUMENT_THEME_ID = BUILT_IN_DOCUMENT_THEMES[0].id

export function getBuiltInDocumentTheme(themeId: string): BuiltInDocumentTheme | undefined {
  return BUILT_IN_DOCUMENT_THEMES.find((theme) => theme.id === themeId)
}

export function scopeDocumentThemeCss(css: string, scope = '.mojian-document'): string {
  return `@scope (${scope}) {\n${css}\n}`
}
