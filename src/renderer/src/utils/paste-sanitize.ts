/**
 * 粘贴净化：把富文本/HTML 转成干净的 Markdown
 *
 * 设计原则：
 *  - 输入纯文本（无 HTML 标签）时只做行尾空白规范化，不强行重排。
 *  - 输入 HTML 时使用 turndown 规则集，剥掉内联样式与噪声节点，
 *    但保留列表/表格/标题/代码块/链接等语义结构。
 *  - 缓存一个 TurndownService 实例，重复粘贴时不需要重新构建。
 */
import TurndownService from 'turndown'

export function sanitizePastedContent(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return ''

  if (!looksLikeHtml(trimmed)) {
    return normalizePlainText(trimmed)
  }
  return convertHtmlToMarkdown(trimmed)
}

export function looksLikeHtml(input: string): boolean {
  return /<\s*(p|div|br|ul|ol|h[1-6]|table|strong|em|span|code|pre|blockquote|img|a)\b/i.test(input)
}

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

let cachedService: TurndownService | null = null

function getTurndownService(): TurndownService {
  if (cachedService) return cachedService

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  // 剥掉所有内联样式 / class / id（这些通常是富文本编辑器的产物）
  service.addRule('stripInlineStyles', {
    filter: (node) => {
      if (!isElement(node)) return false
      node.removeAttribute('style')
      node.removeAttribute('class')
      node.removeAttribute('id')
      return false
    },
    replacement: (content) => content,
  })

  // 去掉空列表项
  service.addRule('dropEmptyListItems', {
    filter: (node) => isElement(node) && node.nodeName === 'LI' && !node.textContent?.trim(),
    replacement: () => '',
  })

  cachedService = service
  return service
}

function isElement(node: unknown): node is { nodeName: string; removeAttribute: (name: string) => void; textContent?: string | null } {
  return typeof node === 'object' && node !== null && 'nodeName' in node && typeof (node as { removeAttribute?: unknown }).removeAttribute === 'function'
}

function convertHtmlToMarkdown(html: string): string {
  const service = getTurndownService()
  const markdown = service.turndown(html)
  return normalizePlainText(markdown)
}
