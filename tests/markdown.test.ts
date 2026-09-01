import { describe, expect, it } from 'vitest'
import {
  countDocument,
  extractOutline,
  markdownForEditor,
  markdownFromEditor,
} from '../src/renderer/src/utils/markdown'

describe('markdown helpers', () => {
  it('extracts ordered outline entries from headings', () => {
    expect(extractOutline('# 标题\n\n## 第二节\n\n### 细节')).toEqual([
      { id: 'heading-0-标题', level: 1, text: '标题', line: 1 },
      { id: 'heading-2-第二节', level: 2, text: '第二节', line: 3 },
      { id: 'heading-4-细节', level: 3, text: '细节', line: 5 },
    ])
  })

  it('ignores heading-looking lines inside fenced code blocks', () => {
    expect(extractOutline('# 标题\n\n```python\n# 不是标题\n```\n\n## 第二节')).toEqual([
      { id: 'heading-0-标题', level: 1, text: '标题', line: 1 },
      { id: 'heading-6-第二节', level: 2, text: '第二节', line: 7 },
    ])
  })

  it('counts CJK characters, latin words, and lines', () => {
    expect(countDocument('# 你好 world\n\n这是第二行')).toEqual({ characters: 12, words: 1, lines: 3 })
  })

  it('round-trips local image paths through editor URLs', () => {
    const root = 'C:\\docs\\notes'
    const source = '![封面](assets/cover image.png)'
    const editorContent = markdownForEditor(source, root)

    expect(editorContent).toContain('file:///C:/docs/notes/assets/cover%20image.png')
    expect(markdownFromEditor(editorContent, root)).toBe(source)
  })
})
