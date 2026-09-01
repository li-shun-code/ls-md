import { describe, expect, it } from 'vitest'
import { extractAiCitations, normalizeAiBaseUrl, parseAiStreamData } from '../src/main/ai-utils'

describe('AI utilities', () => {
  it('normalizes only HTTP and HTTPS base URLs', () => {
    expect(normalizeAiBaseUrl(' https://example.com/v1/// ')).toBe('https://example.com/v1')
    expect(() => normalizeAiBaseUrl('file:///tmp/model')).toThrow('只允许')
    expect(() => normalizeAiBaseUrl('data:text/plain,model')).toThrow('只允许')
  })

  it('parses streamed delta content and completion marker', () => {
    expect(parseAiStreamData('{"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好')
    expect(parseAiStreamData('{"choices":[{"message":{"content":"完成"}}]}')).toBe('完成')
    expect(parseAiStreamData('[DONE]')).toBe('')
  })

  it('maps only valid source markers to document citations', () => {
    const context = [{ id: 'doc-chunk-1', text: '第一段内容', heading: '第一节', startLine: 3, endLine: 5 }]
    expect(extractAiCitations('依据如下 [来源:doc-chunk-1] [source:doc-chunk-404] [来源:doc-chunk-1]', context)).toEqual([
      { id: 'doc-chunk-1', heading: '第一节', startLine: 3, endLine: 5, snippet: '第一段内容' },
    ])
  })
})
