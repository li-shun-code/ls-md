import type { AiDocumentEdit } from './types'

const MAX_SEARCH_RESULTS = 8
const MAX_READ_LINES = 120
const MAX_CONTEXT_CHARS = 2_400

export type DocumentOutlineItem = {
  level: number
  title: string
  line: number
}

export type DocumentExcerpt = {
  text: string
  heading: string
  startLine: number
  endLine: number
}

function splitLines(markdown: string): string[] {
  return markdown.split(/\r?\n/)
}

function lineEnding(markdown: string): string {
  return markdown.includes('\r\n') ? '\r\n' : '\n'
}

function headingsByLine(lines: string[]): Map<number, { level: number; title: string }> {
  const headings = new Map<number, { level: number; title: string }>()
  let inFence = false

  lines.forEach((line, index) => {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const match = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) headings.set(index + 1, { level: match[1].length, title: match[2].trim() })
  })

  return headings
}

function headingForLine(headings: Map<number, { level: number; title: string }>, line: number): string {
  for (let current = line; current >= 1; current -= 1) {
    const heading = headings.get(current)
    if (heading) return heading.title
  }
  return '正文'
}

function makeChunk(
  lines: string[],
  startLine: number,
  endLine: number,
  heading: string,
): DocumentExcerpt {
  const rawText = lines.slice(startLine - 1, endLine).join('\n')
  return {
    text: rawText.length > MAX_CONTEXT_CHARS ? `${rawText.slice(0, MAX_CONTEXT_CHARS)}\n（内容已截断）` : rawText,
    heading,
    startLine,
    endLine,
  }
}

export function getDocumentOutline(markdown: string): DocumentOutlineItem[] {
  const headings = headingsByLine(splitLines(markdown))
  return [...headings.entries()]
    .slice(0, 200)
    .map(([line, heading]) => ({ ...heading, line }))
}

export function searchDocument(markdown: string, query: string): DocumentExcerpt[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) throw new Error('搜索词不能为空')

  const lines = splitLines(markdown)
  const headings = headingsByLine(lines)
  const matches: DocumentExcerpt[] = []
  for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_RESULTS; index += 1) {
    if (!lines[index].toLocaleLowerCase().includes(normalizedQuery)) continue
    const startLine = Math.max(1, index)
    const endLine = Math.min(lines.length, index + 3)
    matches.push(makeChunk(lines, startLine, endLine, headingForLine(headings, index + 1)))
  }
  return matches
}

export function readDocumentRange(markdown: string, startLine: number, endLine: number): DocumentExcerpt {
  const lines = splitLines(markdown)
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error('行号无效，起始行和结束行都应为正整数')
  }
  if (endLine - startLine + 1 > MAX_READ_LINES) throw new Error(`一次最多读取 ${MAX_READ_LINES} 行`)
  if (startLine > lines.length || endLine > lines.length) throw new Error(`文档只有 ${lines.length} 行`)

  const headings = headingsByLine(lines)
  return makeChunk(lines, startLine, endLine, headingForLine(headings, startLine))
}

export function editDocumentRange(
  markdown: string,
  startLine: number,
  endLine: number,
  replacement: string,
): { markdown: string; edit: AiDocumentEdit } {
  const lines = splitLines(markdown)
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine - 1) {
    throw new Error('行号无效；插入内容时结束行应比起始行小 1')
  }
  if (startLine > lines.length + 1 || endLine > lines.length) throw new Error(`文档只有 ${lines.length} 行`)

  const original = lines.slice(startLine - 1, endLine).join('\n')
  const replacementLines = replacement === '' ? [] : replacement.split(/\r?\n/)
  const nextLines = [
    ...lines.slice(0, startLine - 1),
    ...replacementLines,
    ...lines.slice(endLine),
  ]
  return {
    markdown: nextLines.join(lineEnding(markdown)),
    edit: { startLine, endLine, original, replacement },
  }
}

export function applyDocumentEdits(markdown: string, edits: AiDocumentEdit[]): string {
  let result = markdown
  for (const edit of edits) {
    const applied = editDocumentRange(result, edit.startLine, edit.endLine, edit.replacement)
    if (applied.edit.original !== edit.original) throw new Error(`第 ${edit.startLine} 行附近的正文已变化，请重新生成预览`)
    result = applied.markdown
  }
  return result
}
