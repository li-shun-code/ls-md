import { describe, expect, it } from 'vitest'
import { looksLikeHtml, sanitizePastedContent } from '../src/renderer/src/utils/paste-sanitize'

describe('sanitizePastedContent', () => {
  it('保留纯文本只做行尾规范化', () => {
    const input = '第一行   \n第二行\t\n\n\n\n第三行'
    const out = sanitizePastedContent(input)
    expect(out).toBe('第一行\n第二行\n\n第三行')
  })

  it('HTML 转为 Markdown 列表', () => {
    const html = '<ul><li>一</li><li>二</li><li></li></ul>'
    const out = sanitizePastedContent(html)
    expect(out).toMatch(/^-\s+一$/m)
    expect(out).toMatch(/^-\s+二$/m)
    expect(out).not.toContain('style=')
  })

  it('HTML 标题与粗体', () => {
    const html = '<h2>标题</h2><p>这是 <strong>重要</strong> 的内容</p>'
    const out = sanitizePastedContent(html)
    expect(out).toContain('## 标题')
    expect(out).toContain('**重要**')
  })

  it('剥离 style / class / id 等噪声', () => {
    const html = '<p style="color:red" class="gdoc" id="x1">正文</p>'
    const out = sanitizePastedContent(html)
    expect(out).not.toMatch(/style=/)
    expect(out).not.toMatch(/class=/)
    expect(out).not.toMatch(/id="x1"/)
    expect(out).toContain('正文')
  })

  it('空输入返回空字符串', () => {
    expect(sanitizePastedContent('')).toBe('')
    expect(sanitizePastedContent('   \n  ')).toBe('')
  })
})

describe('looksLikeHtml', () => {
  it('识别含 HTML 标签的输入', () => {
    expect(looksLikeHtml('<p>hello</p>')).toBe(true)
    expect(looksLikeHtml('<br/>')).toBe(true)
    expect(looksLikeHtml('<TABLE>')).toBe(true)
  })

  it('不把纯 Markdown 误判为 HTML', () => {
    expect(looksLikeHtml('# 标题')).toBe(false)
    expect(looksLikeHtml('普通 *文本*')).toBe(false)
    expect(looksLikeHtml('- 列表\n- 第二项')).toBe(false)
  })
})
