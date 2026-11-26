export type OutlineItem = {
  id: string
  level: number
  text: string
  line: number
}

export type DocumentStats = {
  characters: number
  words: number
  lines: number
}

export function extractOutline(markdown: string): OutlineItem[] {
  let fenceMarker: string | null = null

  return markdown.split(/\r?\n/).flatMap((line, index) => {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      fenceMarker = fenceMarker === null ? fence[0] : null
      return []
    }
    if (fenceMarker !== null) return []

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) return []

    const text = match[2].replace(/[*_~`]/g, '').trim()
    return [{ id: `heading-${index}-${text}`, level: match[1].length, text, line: index + 1 }]
  })
}

export function countDocument(markdown: string): DocumentStats {
  const visibleText = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/[`*_>#-]/g, ' ')
    .trim()
  const words = visibleText.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  const characters = Array.from(visibleText.replace(/\s/g, '')).length
  const lines = markdown ? markdown.split(/\r?\n/).length : 1
  return { characters, words, lines }
}

function isExternalImageSource(source: string): boolean {
  return /^(?:https?:|data:|file:|blob:)/i.test(source)
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return `file:///${encodeURI(normalized.replace(/^\/+/, ''))}`
}

export function markdownForEditor(markdown: string, workspaceRoot: string): string {
  if (!workspaceRoot) return markdown

  return markdown.replace(/(!\[[^\]]*\]\()([^)]*?)([)])/g, (full, prefix: string, source: string, suffix: string) => {
    if (isExternalImageSource(source)) return full
    const absolute = `${workspaceRoot.replace(/[\\/]$/, '')}/${source}`
    return `${prefix}${toFileUrl(absolute)}${suffix}`
  })
}

export function markdownFromEditor(markdown: string, workspaceRoot: string): string {
  if (!workspaceRoot || !markdown.includes('file:///')) return markdown

  return markdown.replace(/(!\[[^\]]*\]\()file:\/\/\/([^)]*?)([)])/gi, (full, prefix: string, encodedPath: string, suffix: string) => {
    const absolute = decodeURI(encodedPath).replace(/^([A-Za-z]):/, '$1:')
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
    const normalizedAbsolute = absolute.replace(/\\/g, '/')
    if (!normalizedAbsolute.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return full
    return `${prefix}${normalizedAbsolute.slice(normalizedRoot.length + 1)}${suffix}`
  })
}

export function buildExportHtml(title: string, body: string): string {
  const safeTitle = title.replace(/[<>]/g, '')
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, "Microsoft YaHei", sans-serif; color: #24272b; background: #ffffff; }
      body { max-width: 880px; margin: 0 auto; padding: 64px 48px; line-height: 1.8; font-size: 16px; }
      h1, h2, h3, h4 { line-height: 1.25; color: #17191c; }
      h1 { font-size: 2.5rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.45em; }
      h2 { font-size: 1.75rem; border-bottom: 1px solid #eef0f2; padding-bottom: 0.35em; }
      blockquote { margin: 1.5em 0; border-left: 4px solid #4c83bd; padding: 0.65em 1em; color: #56616d; background: #f6f8fa; }
      code { padding: 0.18em 0.45em; border-radius: 4px; background: #f1f3f5; font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace; font-size: 0.92em; }
      pre { padding: 1.1em 1.25em; overflow: auto; border-radius: 8px; background: #1f2933; color: #f7fafc; font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace; font-size: 15px; line-height: 1.68; }
      pre code { padding: 0; background: transparent; font-size: inherit; }
      img { max-width: 100%; height: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 0.5em 0.75em; border: 1px solid #dfe3e8; text-align: left; }
      .mermaid-export { margin: 1.5em 0; overflow: visible; text-align: center; }
      .mermaid-export svg { display: block; width: 100%; max-width: 100%; height: auto; margin: 0 auto; }
    </style>
  </head>
  <body>${body}</body>
</html>`
}
