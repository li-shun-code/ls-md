/**
 * Markdown 快捷输入规则的纯正则匹配测试。
 * Tiptap 的 InputRule 实际触发依赖 ProseMirror Node，完整行为留给 E2E 覆盖。
 * 这里只验证我们写的每条 finder 正则在常见输入上匹配正确。
 */
import { describe, expect, it } from 'vitest'

type RuleCase = { name: string; pattern: RegExp; input: string; expectedMatch: string[] | null }

const rules: RuleCase[] = [
  // 标题
  { name: 'H1', pattern: /^(#{1})\s(.*)$/, input: '# 标题', expectedMatch: ['# 标题', '#', '标题'] },
  { name: 'H2', pattern: /^(#{2})\s(.*)$/, input: '## 次级', expectedMatch: ['## 次级', '##', '次级'] },
  { name: 'H3', pattern: /^(#{3})\s(.*)$/, input: '### 三级', expectedMatch: ['### 三级', '###', '三级'] },
  // 无序列表
  { name: 'UL dash', pattern: /^\s*([-+*])\s(.*)$/, input: '- item', expectedMatch: ['- item', '-', 'item'] },
  { name: 'UL star', pattern: /^\s*([-+*])\s(.*)$/, input: '* star', expectedMatch: ['* star', '*', 'star'] },
  // 有序
  { name: 'OL', pattern: /^\s*(\d+\.)\s(.*)$/, input: '1. first', expectedMatch: ['1. first', '1.', 'first'] },
  // 引用
  { name: 'Quote', pattern: /^\s*>\s(.*)$/, input: '> 引用', expectedMatch: ['> 引用', '引用'] },
  // 代码块
  { name: 'Code fence', pattern: /^\s*```\s*$/, input: '```', expectedMatch: ['```'] },
  // 任务列表
  { name: 'Task unchecked', pattern: /^\s*([-+*])\s\[([ xX])\]\s(.*)$/, input: '- [ ] todo', expectedMatch: ['- [ ] todo', '-', ' ', 'todo'] },
  { name: 'Task checked', pattern: /^\s*([-+*])\s\[([ xX])\]\s(.*)$/, input: '- [x] done', expectedMatch: ['- [x] done', '-', 'x', 'done'] },
  // 行内
  { name: 'Bold **', pattern: /\*\*([^*]+)\*\*$/, input: '**foo**', expectedMatch: ['**foo**', 'foo'] },
  { name: 'Bold __', pattern: /__([^_]+)__$/, input: '__foo__', expectedMatch: ['__foo__', 'foo'] },
  { name: 'Italic *', pattern: /(^|[^*])\*([^*\s][^*]*)\*$/, input: '*foo*', expectedMatch: ['*foo*', '', 'foo'] },
  { name: 'Strike', pattern: /~~([^~]+)~~$/, input: '~~old~~', expectedMatch: ['~~old~~', 'old'] },
  { name: 'Highlight', pattern: /==([^=]+)==$/, input: '==hi==', expectedMatch: ['==hi==', 'hi'] },
  { name: 'Inline code', pattern: /`([^`]+)`$/, input: '`x`', expectedMatch: ['`x`', 'x'] },
]

describe('markdown input rule 正则匹配', () => {
  for (const { name, pattern, input, expectedMatch } of rules) {
    it(`${name} 匹配 "${input}"`, () => {
      const result = pattern.exec(input)
      expect(result).not.toBeNull()
      expect(result?.slice(0, expectedMatch.length)).toEqual(expectedMatch)
    })
  }

  it('Italic * 不与 ** 冲突', () => {
    const pattern = /(^|[^*])\*([^*\s][^*]*)\*$/
    expect(pattern.exec('**bold**')).toBeNull()
  })

  it('Code fence 必须是整行（不能被混入文字）', () => {
    const pattern = /^\s*```\s*$/
    expect(pattern.exec('```ts')).toBeNull()
    expect(pattern.exec('not a fence ```')).toBeNull()
  })

  it('Bold 只在末尾成对触发', () => {
    const pattern = /\*\*([^*]+)\*\*$/
    expect(pattern.exec('**foo** bar')).toBeNull()
  })
})
