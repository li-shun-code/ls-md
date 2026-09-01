import type { AiCitation, AiContextChunk } from '../shared/types'

export function normalizeAiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('AI Base URL 格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AI Base URL 只允许使用 http 或 https')
  }
  return trimmed
}

export function parseAiStreamData(data: string): string {
  if (data.trim() === '[DONE]') return ''

  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: string }
        message?: { content?: string }
      }>
    }
    return payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? ''
  } catch {
    return ''
  }
}

export function extractAiCitations(answer: string, context: AiContextChunk[]): AiCitation[] {
  const ids = [...answer.matchAll(/\[(?:来源|source)[:：]\s*([^\]]+)\]/gi)].map((match) => match[1].trim())
  const uniqueIds = [...new Set(ids)]
  return uniqueIds
    .map((id) => context.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is AiContextChunk => Boolean(chunk))
    .map((chunk) => ({
      id: chunk.id,
      heading: chunk.heading,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      snippet: chunk.text.replace(/\s+/g, ' ').slice(0, 150),
    }))
}
