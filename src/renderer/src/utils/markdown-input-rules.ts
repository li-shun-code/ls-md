/**
 * Markdown 快捷输入规则：输入即转换（类似 Typora）
 *
 * 只声明 finder / getAttributes 纯逻辑，不做任何 DOM 操作，
 * 便于在纯 Node 环境（Vitest）下单测匹配行为。
 */
import { InputRule, markInputRule, nodeInputRule } from '@tiptap/core'
import type { MarkType, NodeType } from '@tiptap/pm/model'

type MarkRuleSpec = {
  patterns: RegExp[]
  type: MarkType
}

/**
 * 构造 Markdown 快捷输入规则数组。
 * 返回后的规则由调用方（MarkdownEditor）注册进编辑器扩展。
 */
export function createMarkdownInputRules(
  markTypes: {
    bold: MarkType
    italic: MarkType
    strike: MarkType
    highlight: MarkType
    code: MarkType
  },
  nodeTypes: {
    heading: NodeType
    bulletList: NodeType
    orderedList: NodeType
    taskList: NodeType
    taskItem: NodeType
    blockquote: NodeType
    codeBlock: NodeType
  },
): InputRule[] {
  const rules: InputRule[] = []

  // 标题：1~6 级，`# ` 或 `### ` 后接内容
  ;[1, 2, 3, 4, 5, 6].forEach((level) => {
    const pattern = new RegExp(`^(#{${level}})\\s(.*)$`)
    rules.push(
      nodeInputRule({
        find: pattern,
        type: nodeTypes.heading,
        getAttributes: () => ({ level }),
      }),
    )
  })

  // 无序列表：`- ` / `* ` / `+ `
  rules.push(
    nodeInputRule({
      find: /^\s*([-+*])\s(.*)$/,
      type: nodeTypes.bulletList,
    }),
  )

  // 有序列表：`1. `
  rules.push(
    nodeInputRule({
      find: /^\s*(\d+\.)\s(.*)$/,
      type: nodeTypes.orderedList,
    }),
  )

  // 引用块：`> `
  rules.push(
    nodeInputRule({
      find: /^\s*>\s(.*)$/,
      type: nodeTypes.blockquote,
    }),
  )

  // 代码块：行首 ```（独占一行）
  rules.push(
    nodeInputRule({
      find: /^\s*```\s*$/,
      type: nodeTypes.codeBlock,
    }),
  )

  // 任务列表：`- [ ] ` / `- [x] `，用自定义 handler 同时产出外层列表与任务项
  rules.push(
    InputRule.create({
      find: /^\s*([-+*])\s\[([ xX])\]\s(.*)$/,
      handler: ({ state, range, match }) => {
        const checked = match[2] === 'x' || match[2] === 'X'
        const content = match[3] ?? ''
        const { tr } = state
        const taskItem = nodeTypes.taskItem.create({ checked }, content ? state.schema.text(content) : undefined)
        tr.replaceWith(range.from - 1, range.to, nodeTypes.taskList.create(null, taskItem))
      },
    }),
  )

  // 行内环绕样式：**bold** / __bold__ / *italic* / _italic_ / ~~strike~~ / ==highlight== / `code`
  const inlineRules: MarkRuleSpec[] = [
    { patterns: [/\*\*([^*]+)\*\*$/, /__([^_]+)__$/], type: markTypes.bold },
    { patterns: [/(^|[^*])\*([^*\s][^*]*)\*$/, /(^|[^_])_([^_\s][^_]*)_$/], type: markTypes.italic },
    { patterns: [/~~([^~]+)~~$/], type: markTypes.strike },
    { patterns: [/==([^=]+)==$/], type: markTypes.highlight },
    { patterns: [/`([^`]+)`$/], type: markTypes.code },
  ]
  inlineRules.forEach(({ patterns, type }) => {
    patterns.forEach((pattern) => {
      rules.push(markInputRule({ find: pattern, type }))
    })
  })

  return rules
}