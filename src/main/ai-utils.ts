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
  return parseAiStreamChunk(data)?.content ?? ''
}

export type AiToolCallDelta = {
  index: number
  id?: string
  name?: string
  arguments?: string
}

export type ParsedAiStreamChunk = {
  content: string
  toolCalls: AiToolCallDelta[]
}

export function parseAiStreamChunk(data: string): ParsedAiStreamChunk | null {
  if (data.trim() === '[DONE]') return null

  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        message?: { content?: string }
      }>
    }
    const choice = payload.choices?.[0]
    return {
      content: choice?.delta?.content ?? choice?.message?.content ?? '',
      toolCalls: choice?.delta?.tool_calls?.map((toolCall, index) => ({
        index: toolCall.index ?? index,
        ...(toolCall.id ? { id: toolCall.id } : {}),
        ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
        ...(toolCall.function?.arguments ? { arguments: toolCall.function.arguments } : {}),
      })) ?? [],
    }
  } catch {
    return null
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
