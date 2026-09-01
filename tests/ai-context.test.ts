import { describe, expect, it } from 'vitest'
import { chunkMarkdown, retrieveContext } from '../src/renderer/src/utils/ai-context'

describe('document AI context', () => {
  it('keeps fenced code in one chunk and preserves source line numbers', () => {
    const code = Array.from({ length: 120 }, (_, index) => `const item${index} = "value-${index}"`).join('\n')
    const markdown = `# 代码\n\n\`\`\`ts\n${code}\n\`\`\`\n\n## 结尾\n最后一段`
    const chunks = chunkMarkdown(markdown)
    const codeChunk = chunks.find((chunk) => chunk.text.includes('const item0'))

    expect(codeChunk?.text).toContain('const item119')
    expect(codeChunk?.startLine).toBe(1)
    expect(chunks.at(-1)?.text).toContain('最后一段')
    expect(chunks.at(-1)?.endLine).toBe(markdown.split('\n').length)
  })

  it('ranks matching headings and limits the number of chunks', () => {
    const markdown = Array.from({ length: 12 }, (_, index) => `## 模块 ${index}\n\n这里是模块 ${index} 的说明。`).join('\n\n')
    const chunks = retrieveContext(markdown, '模块 7', 6)

    expect(chunks.length).toBeLessThanOrEqual(6)
    expect(chunks[0].text).toContain('模块 7')
  })
})
