import { useEffect, useState } from 'react'
import { Check, Loader2, Palette, Upload } from 'lucide-react'
import type { DocumentThemeSummary, ImportedDocumentTheme } from '@shared/types'
import {
  BUILT_IN_DOCUMENT_THEMES,
  scopeDocumentThemeCss,
} from '@renderer/utils/document-themes'

const DOCUMENT_THEME_TEMPLATE = `:scope {
  color: #26312b;
  background-color: #f4f1e8;
  font-family: Georgia, "Songti SC", serif;
}

:scope h1 { color: #233f32; }
:scope a { color: #3f745d; }`

type DocumentThemesTabProps = {
  selectedThemeId: string
  onSelectTheme: (themeId: string) => void
}

export function DocumentThemesTab({ selectedThemeId, onSelectTheme }: DocumentThemesTabProps) {
  const [customThemes, setCustomThemes] = useState<ImportedDocumentTheme[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [themeError, setThemeError] = useState('')
  const [themeNotice, setThemeNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.desktop.listDocumentThemes().then(async (themes) => {
      const loaded = await Promise.all(themes.map(async (theme: DocumentThemeSummary) => ({
        ...theme,
        css: await window.desktop.readDocumentTheme(theme.id) ?? '',
      })))
      if (!cancelled) setCustomThemes(loaded.filter((theme) => theme.css))
    }).catch((error) => {
      if (!cancelled) setThemeError(error instanceof Error ? error.message : '无法读取自定义主题')
    })
    return () => { cancelled = true }
  }, [])

  const handleImportTheme = async () => {
    setIsImporting(true)
    setThemeError('')
    setThemeNotice('')
    try {
      const theme = await window.desktop.importDocumentTheme()
      if (!theme) return
      setCustomThemes((current) => [...current.filter((item) => item.id !== theme.id), theme])
      onSelectTheme(theme.id)
      setThemeNotice(`已导入并应用“${theme.name}”`)
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : '导入主题失败')
    } finally {
      setIsImporting(false)
    }
  }

  const themes = [
    ...BUILT_IN_DOCUMENT_THEMES,
    ...customThemes.map((theme) => ({ ...theme, description: '自定义 CSS 主题', swatches: [] as string[] })),
  ]

  return (
    <div className="settings-theme-tab">
      <section className="settings-theme-guide" aria-labelledby="settings-theme-guide-title">
        <div className="settings-theme-guide-header">
          <div className="settings-theme-guide-icon" aria-hidden="true"><Palette size={17} /></div>
          <div>
            <h3 id="settings-theme-guide-title">自定义主题规范</h3>
            <p>主题是单个 CSS 文件。规则在文档作用域中生效，不会改变侧栏、设置、源码编辑器或系统标题栏。</p>
          </div>
        </div>
        <ul className="settings-theme-guide-rules">
          <li>使用 <code>:scope</code> 指文档根节点，标题等子元素使用 <code>:scope h1</code>。</li>
          <li>不要使用 <code>body</code>、<code>:root</code> 或应用界面的全局选择器。</li>
          <li>主题会应用到可视化编辑区以及 HTML、PDF、Word 导出；使用系统已安装字体。</li>
          <li>选择主题后会立即应用，并在下次启动时保留。</li>
          <li>文件不超过 512 KB；不支持 <code>@import</code>、<code>url()</code> 外部资源或脚本。</li>
        </ul>
        <details className="settings-theme-guide-example" open>
          <summary>查看 CSS 示例</summary>
          <pre><code>{DOCUMENT_THEME_TEMPLATE}</code></pre>
        </details>
      </section>

      <div className="settings-theme-library">
        <div className="settings-theme-library-heading">
          <div>
            <h3>Typora 经典内置主题</h3>
            <p>GitHub、Gothic、Newsprint、Night、Pixyll、Whitey，以及你导入的自定义主题。</p>
          </div>
          <button
            type="button"
            className="settings-modal-btn settings-theme-import"
            onClick={() => void handleImportTheme()}
            disabled={isImporting}
          >
            {isImporting ? <Loader2 size={15} className="settings-spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            <span>{isImporting ? '正在导入…' : '导入 CSS 主题'}</span>
          </button>
        </div>

        <div className="settings-theme-grid" role="group" aria-label="文档主题">
          {themes.map((theme) => (
            <div
              className={`settings-theme-card${selectedThemeId === theme.id ? ' is-selected' : ''}`}
              data-theme-card={theme.id}
              key={theme.id}
            >
              <style>{scopeDocumentThemeCss(theme.css, `[data-theme-preview="${theme.id}"]`)}</style>
              <div className="settings-theme-preview mojian-document tiptap-editor" data-theme-preview={theme.id}>
                <h1>写下你的想法</h1>
                <p>清晰的正文、<a href="#preview">链接</a>和 <code>行内代码</code>。</p>
                <blockquote><p>让长文阅读保持舒适。</p></blockquote>
                <ul><li>标题和段落</li><li>引用和列表</li></ul>
                <table><tbody><tr><th>主题</th><th>预览</th></tr><tr><td>Typora</td><td>内置样式</td></tr></tbody></table>
                <pre><code>const editor = 'Mojian'</code></pre>
              </div>
              <button
                type="button"
                className="settings-theme-choice"
                aria-label={theme.name}
                aria-pressed={selectedThemeId === theme.id}
                onClick={() => {
                  setThemeNotice('')
                  setThemeError('')
                  onSelectTheme(theme.id)
                }}
              >
                <span className="settings-theme-card-info">
                  <span className="settings-theme-card-copy">
                    <strong>{theme.name}</strong>
                    <small>{theme.description}</small>
                  </span>
                  <span className="settings-theme-swatches" aria-hidden="true">
                    {theme.swatches.map((color) => (
                      <i key={color} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  {selectedThemeId === theme.id && (
                    <span className="settings-theme-current">
                      <Check size={14} aria-hidden="true" />
                      <span>当前</span>
                    </span>
                  )}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {themeError && <div className="settings-form-error" role="alert">{themeError}</div>}
      {themeNotice && <div className="settings-theme-notice" role="status">{themeNotice}</div>}
    </div>
  )
}
