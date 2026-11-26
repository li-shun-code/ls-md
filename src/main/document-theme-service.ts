import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImportedDocumentTheme, DocumentThemeSummary } from '../shared/types'

const MAX_THEME_SIZE = 512 * 1024

function hasBalancedCssBlocks(css: string): boolean {
  let depth = 0
  let quote: '"' | "'" | null = null
  let comment = false
  let escaped = false

  for (let index = 0; index < css.length; index += 1) {
    const current = css[index]
    const next = css[index + 1]

    if (comment) {
      if (current === '*' && next === '/') {
        comment = false
        index += 1
      }
      continue
    }

    if (quote) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = null
      continue
    }

    if (current === '/' && next === '*') {
      comment = true
      index += 1
    } else if (current === '"' || current === "'") {
      quote = current
    } else if (current === '{') {
      depth += 1
    } else if (current === '}') {
      depth -= 1
      if (depth < 0) return false
    }
  }

  return depth === 0 && quote === null && !comment
}

function validateThemeCss(css: string): void {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (Buffer.byteLength(css, 'utf8') > MAX_THEME_SIZE) {
    throw new Error('主题 CSS 文件不能超过 512 KB')
  }
  if (!css.trim()) throw new Error('主题 CSS 文件为空')
  if (!hasBalancedCssBlocks(css)) throw new Error('主题 CSS 语法不完整，请检查括号或引号')
  if (!/:scope\b/.test(withoutComments)) throw new Error('主题必须使用 :scope 作为文档样式根节点')
  if (/@import\b|url\s*\(|<\/style/i.test(withoutComments)) {
    throw new Error('主题不能加载外部 CSS、字体或图片资源')
  }
}

export class DocumentThemeService {
  private readonly directory: string

  public constructor(userDataDirectory: string) {
    this.directory = path.join(userDataDirectory, 'document-themes')
  }

  public async importTheme(sourcePath: string): Promise<ImportedDocumentTheme> {
    if (path.extname(sourcePath).toLowerCase() !== '.css') {
      throw new Error('只支持导入 .css 主题文件')
    }

    if ((await stat(sourcePath)).size > MAX_THEME_SIZE) {
      throw new Error('主题 CSS 文件不能超过 512 KB')
    }
    const css = await readFile(sourcePath, 'utf8')
    validateThemeCss(css)

    const theme = {
      id: randomUUID(),
      name: path.basename(sourcePath, path.extname(sourcePath)).trim() || '自定义主题',
      css,
    }
    await mkdir(this.directory, { recursive: true })
    await writeFile(path.join(this.directory, `${theme.id}.json`), JSON.stringify(theme), 'utf8')
    return theme
  }

  public async listThemes(): Promise<DocumentThemeSummary[]> {
    try {
      const files = await readdir(this.directory)
      const themes = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
        try {
          const theme = JSON.parse(await readFile(path.join(this.directory, file), 'utf8')) as ImportedDocumentTheme
          if (typeof theme.id !== 'string' || typeof theme.name !== 'string' || typeof theme.css !== 'string') return null
          return { id: theme.id, name: theme.name }
        } catch {
          return null
        }
      }))
      return themes.filter((theme): theme is DocumentThemeSummary => theme !== null)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    } catch {
      return []
    }
  }

  public async readTheme(themeId: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(themeId)) return null
    try {
      const theme = JSON.parse(await readFile(path.join(this.directory, `${themeId}.json`), 'utf8')) as ImportedDocumentTheme
      return theme.id === themeId && typeof theme.css === 'string' ? theme.css : null
    } catch {
      return null
    }
  }
}
