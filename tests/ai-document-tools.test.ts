import { describe, expect, it } from 'vitest'
import { applyDocumentEdits, editDocumentRange, getDocumentOutline, readDocumentRange, searchDocument } from '../src/shared/ai-document-tools'

describe('AI document tools', () => {
  const markdown = '# 介绍\n\n正文内容。\n\n## 结论\n\n原始结论。'

  it('reads outline, searches matches, and returns bounded line ranges', () => {
    expect(getDocumentOutline(`${markdown}\n\n\`\`\`md\n# 代码中的标题\n\`\`\``)).toEqual([
      { level: 1, title: '介绍', line: 1 },
      { level: 2, title: '结论', line: 5 },
    ])
    expect(searchDocument(markdown, '结论')[0]).toMatchObject({ startLine: 4, endLine: 7, heading: '结论' })
    expect(readDocumentRange(markdown, 5, 7)).toMatchObject({ startLine: 5, endLine: 7, text: '## 结论\n\n原始结论。' })
    expect(() => readDocumentRange(markdown, 1, 121)).toThrow('最多读取 120 行')
  })

  it('creates ordered, line-based edits for preview and replays them safely', () => {
    const first = editDocumentRange(markdown, 7, 7, '修改后的结论。')
    const second = editDocumentRange(first.markdown, 3, 3, '调整后的正文。')

    expect(applyDocumentEdits(markdown, [first.edit, second.edit])).toBe(second.markdown)
    expect(() => applyDocumentEdits(markdown.replace('原始结论。', '已被外部修改。'), [first.edit])).toThrow('正文已变化')
  })

  it('inserts at a line boundary without replacing neighboring lines', () => {
    expect(editDocumentRange(markdown, 6, 5, '新增段落。').markdown).toBe('# 介绍\n\n正文内容。\n\n## 结论\n新增段落。\n\n原始结论。')
  })
})
