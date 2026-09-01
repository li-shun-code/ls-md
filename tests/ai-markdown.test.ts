import { describe, expect, it } from 'vitest'
import { renderAiMarkdown } from '../src/renderer/src/utils/ai-markdown'

describe('AI Markdown rendering', () => {
  it('renders common Markdown blocks instead of showing syntax', () => {
    const html = renderAiMarkdown('## 结论\n\n**重点**\n\n| 模块 | 状态 |\n| --- | --- |\n| 编辑器 | 完成 |\n\n```ts\nconst ready = true\n```')

    expect(html).toContain('<h2>结论</h2>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('<pre><code class="language-ts">const ready = true</code></pre>')
    expect(html).not.toContain('## 结论')
  })

  it('escapes raw HTML and rejects unsafe links', () => {
    const html = renderAiMarkdown('<script>alert(1)</script>\n\n[危险](javascript:alert(1))')

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
  })
})
