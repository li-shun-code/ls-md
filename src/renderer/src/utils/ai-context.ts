import type { AiContextChunk } from '@shared/types'

const MAX_CHUNK_CHARS = 1600
const OVERLAP_CHARS = 240

function headingFromLine(line: string): string | null {
  const match = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
  return match?.[1].replace(/[*_~`]/g, '').trim() || null
}

function pushChunk(chunks: AiContextChunk[], lines: string[], startLine: number, endLine: number, heading: string): void {
  const text = lines.slice(startLine, endLine + 1).join('\n').trim()
  if (!text) return
  chunks.push({
    id: `doc-chunk-${chunks.length + 1}`,
    text,
    heading,
    startLine: startLine + 1,
    endLine: endLine + 1,
  })
}

export function chunkMarkdown(markdown: string): AiContextChunk[] {
  if (!markdown.trim()) return []

  const lines = markdown.split(/\r?\n/)
  const chunks: AiContextChunk[] = []
  let chunkStart = 0
  let chunkHeading = '正文'
  let activeHeading = '正文'
  let inFence = false
  let chunkLength = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineHeading = headingFromLine(line)
    if (!inFence && lineHeading && index > chunkStart && chunkLength >= MAX_CHUNK_CHARS / 2) {
      pushChunk(chunks, lines, chunkStart, index - 1, chunkHeading)
      chunkStart = index
      chunkLength = 0
      chunkHeading = lineHeading
    }
    if (lineHeading && !inFence) activeHeading = lineHeading
    if (index === chunkStart && chunkLength === 0) chunkHeading = activeHeading

    chunkLength += line.length + (index > chunkStart ? 1 : 0)
    if (/^\s*(`{3,}|~{3,})/.test(line)) inFence = !inFence

    if (!inFence && chunkLength >= MAX_CHUNK_CHARS) {
      pushChunk(chunks, lines, chunkStart, index, chunkHeading)

      if (line.length > OVERLAP_CHARS) {
        chunkStart = index + 1
        chunkLength = 0
      } else {
        let overlapStart = index + 1
        let overlapLength = 0
        while (overlapStart > chunkStart) {
          const candidate = overlapStart - 1
          const nextLength = lines[candidate].length + (overlapStart <= index ? 1 : 0)
          if (overlapLength + nextLength > OVERLAP_CHARS) break
          overlapLength += nextLength
          overlapStart = candidate
        }
        chunkStart = overlapStart
        chunkLength = overlapLength
      }
      chunkHeading = activeHeading
    }
  }

  if (chunkStart < lines.length) pushChunk(chunks, lines, chunkStart, lines.length - 1, chunkHeading)
  return chunks
}

function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const segment of text.toLocaleLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]+/gi) ?? []) {
    if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      if (segment.length === 1) tokens.push(segment)
      else for (let index = 0; index < segment.length - 1; index += 1) tokens.push(segment.slice(index, index + 2))
    } else {
      tokens.push(segment)
    }
  }
  return [...new Set(tokens)]
}

export function retrieveContext(markdown: string, query: string, maxChunks = 6): AiContextChunk[] {
  const chunks = chunkMarkdown(markdown)
  if (chunks.length <= maxChunks) return chunks

  const tokens = tokenize(query)
  if (tokens.length === 0) return chunks.slice(0, maxChunks)
  const phrase = query.trim().toLocaleLowerCase()

  return chunks
    .map((chunk, index) => {
      const text = chunk.text.toLocaleLowerCase()
      const heading = chunk.heading.toLocaleLowerCase()
      const tokenScore = tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0)
      const headingScore = tokens.reduce((score, token) => score + (heading.includes(token) ? 2 : 0), 0)
      const phraseScore = phrase && text.includes(phrase) ? 3 : 0
      return { chunk, index, score: tokenScore + headingScore + phraseScore }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxChunks)
    .map((item) => item.chunk)
}
