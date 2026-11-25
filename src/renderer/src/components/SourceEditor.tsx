/**
 * 源码模式编辑器：基于 CodeMirror 6
 *
 * - 行号 / Markdown 语法高亮 / 括号匹配 / 折叠 / Tab 缩进
 * - 暴露与原 textarea 一致的接口（onChange / onCursorChange），
 *   方便 MarkdownEditor 在切换 mode 时直接替换渲染。
 */
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, defaultHighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, class: 'cm-md-heading' },
  { tag: t.heading1, class: 'cm-md-heading cm-md-heading-1' },
  { tag: t.heading2, class: 'cm-md-heading cm-md-heading-2' },
  { tag: t.heading3, class: 'cm-md-heading cm-md-heading-3' },
  { tag: t.heading4, class: 'cm-md-heading cm-md-heading-4' },
  { tag: t.emphasis, class: 'cm-md-italic' },
  { tag: t.strong, class: 'cm-md-bold' },
  { tag: t.strikethrough, class: 'cm-md-strike' },
  { tag: t.link, class: 'cm-md-link' },
  { tag: t.url, class: 'cm-md-url' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: t.list, class: 'cm-md-list' },
  { tag: t.processingInstruction, class: 'cm-md-meta' },
  { tag: t.contentSeparator, class: 'cm-md-separator' },
])

export type SourceEditorProps = {
  value: string
  onChange: (next: string) => void
  onCursorChange?: (cursor: { line: number; column: number }) => void
  onRunCode?: () => void
}

export function SourceEditor({ value, onChange, onCursorChange, onRunCode }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onRunCodeRef = useRef(onRunCode)
  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange
  onRunCodeRef.current = onRunCode

  useEffect(() => {
    if (!hostRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: () => null }),
        syntaxHighlighting(markdownHighlight, { fallback: true }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
          {
            key: 'Mod-Enter',
            run: () => {
              onRunCodeRef.current?.()
              return true
            },
          },
        ]),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            onCursorChangeRef.current?.({ line: line.number, column: head - line.from + 1 })
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '15px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
          '.cm-content': { padding: '16px 12px' },
          '.cm-gutters': { background: 'transparent', borderRight: '1px solid var(--border)' },
        }),
      ],
    })

    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value 在另一 effect 中同步，这里只需初始化一次
  }, [])

  // 外部 value 变化时同步到编辑器（避免光标跳动，仅在 doc 不一致时替换）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return <div ref={hostRef} className="source-editor-cm" />
}
