import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import Highlight from '@tiptap/extension-highlight'
import { Mathematics } from '@tiptap/extension-mathematics'
import 'katex/dist/katex.min.css'
import katex from 'katex'
import mermaid from 'mermaid'
import { toPng } from 'html-to-image'
import { common, createLowlight } from 'lowlight'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import {
  Bold,
  Code,
  Copy,
  ExternalLink,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link,
  Maximize2,
  Redo2,
  Scissors,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Undo2,
  Unlink,
  Workflow,
} from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import type { AiOperation, AiSelection, MarkdownMode } from '@shared/types'
import { markdownForEditor, markdownFromEditor } from '@renderer/utils/markdown'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    primaryColor: '#edf4fa',
    primaryTextColor: '#27313a',
    primaryBorderColor: '#4b83b4',
    lineColor: '#61707e',
    secondaryColor: '#f7f7f7',
    tertiaryColor: '#ffffff',
  },
})

function prepareSvgForPreview(svg: SVGElement): { markup: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGElement
  clone.removeAttribute('style')

  let width = 800
  let height = 600
  const viewBox = clone.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = Math.ceil(parts[2])
      height = Math.ceil(parts[3])
    }
  } else {
    const w = parseFloat(clone.getAttribute('width') ?? '')
    const h = parseFloat(clone.getAttribute('height') ?? '')
    if (w > 0 && h > 0) {
      width = Math.ceil(w)
      height = Math.ceil(h)
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
  }

  clone.setAttribute('width', `${width}`)
  clone.setAttribute('height', `${height}`)
  clone.setAttribute('style', 'width: 100%; height: 100%; max-width: none; max-height: none; display: block;')

  return { markup: clone.outerHTML, width, height }
}

export type EditorCommands = {
  focus: () => void
  loadMarkdown: (markdown: string) => void
  getHtml: () => string
  getHtmlForExport: () => Promise<string>
  getHtmlForDocx: () => Promise<string>
  toggleBold: () => void
  toggleItalic: () => void
  toggleStrike: () => void
  toggleInlineCode: () => void
  setHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void
  setParagraph: () => void
  setLink: (url: string) => void
  insertTable: () => void
  toggleBulletList: () => void
  toggleOrderedList: () => void
  toggleTaskList: () => void
  toggleBlockquote: () => void
  toggleCodeBlock: () => void
  insertHorizontalRule: () => void
  insertImage: (source: string, alt: string) => void
  getSelection: () => AiSelection | null
  replaceSelection: (markdown: string) => void
  replaceDocument: (markdown: string) => void
  selectLine: (line: number) => void
  selectHeading: (headingIndex: number, sourceLine: number) => void
}

export type EditorPreview =
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'svg'; markup: string; title: string; width?: number; height?: number }

type MarkdownEditorProps = {
  markdown: string
  mode: MarkdownMode
  workspaceRoot: string
  /** 当前文档标识：变化时读取/记录该文档的阅读滚动位置（null 表示未打开文件） */
  scrollPositionKey?: string | null
  enableInputRules: boolean
  enableTypewriter: boolean
  onMarkdownChange: (markdown: string) => void
  onSourceChange: (markdown: string) => void
  onCursorChange: (cursor: { line: number; column: number }) => void
  onDropImage: (sourcePath: string) => void
  onOpenPreview: (preview: EditorPreview) => void
  onNavigateLink?: (href: string) => void
  onTriggerAiAction?: (operation: AiOperation, selectedText: string) => void
  onRunCode?: (language: string, code: string, workingDirectory?: string) => void
}

function selectSourceLine(source: HTMLTextAreaElement, line: number) {
  const lines = source.value.split('\n')
  const safeLine = Math.max(1, Math.min(line, lines.length))
  const start = lines.slice(0, safeLine - 1).reduce((total, item) => total + item.length + 1, 0)
  source.focus()
  source.setSelectionRange(start, start + (lines[safeLine - 1]?.length ?? 0))
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const temporary = document.createElement('textarea')
  temporary.value = text
  temporary.style.position = 'fixed'
  temporary.style.opacity = '0'
  document.body.appendChild(temporary)
  temporary.select()
  document.execCommand('copy')
  temporary.remove()
}

function formatLanguage(rawLang?: string): string {
  const lang = rawLang?.trim().toLowerCase()
  if (!lang) return 'Text'
  switch (lang) {
    case 'py':
    case 'python':
      return 'Python'
    case 'js':
    case 'javascript':
    case 'node':
      return 'JavaScript'
    case 'ts':
    case 'typescript':
      return 'TypeScript'
    case 'sh':
    case 'bash':
    case 'shell':
      return 'Bash'
    case 'ps1':
    case 'powershell':
      return 'PowerShell'
    case 'go':
    case 'golang':
      return 'Go'
    case 'rs':
    case 'rust':
      return 'Rust'
    case 'java':
      return 'Java'
    case 'cpp':
    case 'c++':
      return 'C++'
    case 'c':
      return 'C'
    case 'html':
      return 'HTML'
    case 'css':
      return 'CSS'
    case 'json':
      return 'JSON'
    case 'sql':
      return 'SQL'
    case 'md':
    case 'markdown':
      return 'Markdown'
    default:
      return lang.charAt(0).toUpperCase() + lang.slice(1)
  }
}

let mermaidDiagramId = 0

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function renderMathForExport(container: HTMLElement): Promise<void> {
  await document.fonts.ready
  const mathNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]'))
  for (const node of mathNodes) {
    const latex = node.getAttribute('data-latex') ?? ''
    const displayMode = node.dataset.type === 'block-math'
    const formula = document.createElement(displayMode ? 'div' : 'span')
    formula.className = 'tiptap-mathematics-render'
    formula.style.cssText = displayMode
      ? 'display:table;max-width:100%;margin:1em auto;'
      : 'display:inline-block;vertical-align:middle;'
    katex.render(latex, formula, { throwOnError: false, displayMode })
    node.replaceWith(formula)

    const bounds = formula.getBoundingClientRect()
    if (!bounds.width || !bounds.height) {
      formula.textContent = latex
      continue
    }

    try {
      const image = document.createElement('img')
      image.src = await toPng(formula, { pixelRatio: 3, backgroundColor: '#ffffff' })
      image.alt = '数学公式'
      image.width = Math.ceil(bounds.width)
      image.height = Math.ceil(bounds.height)
      image.style.cssText = displayMode
        ? `display:block;width:${bounds.width}px;height:${bounds.height}px;max-width:100%;margin:1em auto;`
        : `display:inline-block;width:${bounds.width}px;height:${bounds.height}px;vertical-align:middle;`
      formula.replaceWith(image)
    } catch {
      formula.textContent = latex
    }
  }
}

function createMermaidNodeView(node: ProseMirrorNode, onOpenPreview?: (preview: EditorPreview) => void) {
  const dom = document.createElement('div')
  const toolbar = document.createElement('div')
  const label = document.createElement('span')
  const actionGroup = document.createElement('div')
  const viewButton = document.createElement('button')
  const editButton = document.createElement('button')
  const preview = document.createElement('div')
  const source = document.createElement('code')
  let sourceVisible = false
  let renderVersion = 0
  let renderedNode = node

  dom.className = 'mermaid-block'
  dom.setAttribute('data-diagram', 'mermaid')
  toolbar.className = 'mermaid-toolbar'
  label.className = 'mermaid-label'
  label.textContent = '流程图'
  actionGroup.className = 'mermaid-actions'

  viewButton.type = 'button'
  viewButton.className = 'mermaid-tool-button'
  viewButton.setAttribute('contenteditable', 'false')
  viewButton.setAttribute('aria-label', '全屏查看流程图')
  viewButton.textContent = '查看大图'
  viewButton.addEventListener('mousedown', (event) => event.preventDefault())
  viewButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const svg = preview.querySelector('svg')
    if (svg instanceof SVGElement && onOpenPreview) {
      const { markup, width, height } = prepareSvgForPreview(svg)
      onOpenPreview({ kind: 'svg', markup, title: '流程图', width, height })
    }
  })

  editButton.type = 'button'
  editButton.className = 'mermaid-tool-button'
  editButton.setAttribute('contenteditable', 'false')
  editButton.setAttribute('aria-label', '编辑流程图源码')
  editButton.textContent = '编辑源码'
  editButton.addEventListener('mousedown', (event) => event.preventDefault())
  editButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setSourceVisibility(!sourceVisible)
  })

  actionGroup.append(viewButton, editButton)

  preview.className = 'mermaid-preview'
  preview.setAttribute('contenteditable', 'false')
  preview.setAttribute('role', 'img')
  preview.setAttribute('aria-label', 'Mermaid 流程图')
  source.className = 'mermaid-source language-mermaid'
  source.setAttribute('spellcheck', 'false')

  const setSourceVisibility = (visible: boolean) => {
    sourceVisible = visible
    dom.classList.toggle('is-source-visible', visible)
    editButton.textContent = visible ? '隐藏源码' : '编辑源码'
  }

  const renderPreview = (currentNode: ProseMirrorNode) => {
    const definition = currentNode.textContent.trim()
    const currentVersion = ++renderVersion
    source.className = 'mermaid-source language-mermaid'

    if (!definition) {
      preview.className = 'mermaid-preview is-empty'
      preview.textContent = '切换到源码模式，输入 Mermaid 流程图代码。'
      return
    }

    preview.className = 'mermaid-preview is-loading'
    preview.textContent = '正在渲染流程图…'
    void mermaid.render(`mermaid-diagram-${++mermaidDiagramId}`, definition).then(({ svg, bindFunctions }) => {
      if (currentVersion !== renderVersion) return
      preview.className = 'mermaid-preview'
      preview.innerHTML = svg
      bindFunctions?.(preview)
    }).catch(() => {
      if (currentVersion !== renderVersion) return
      preview.className = 'mermaid-preview has-error'
      preview.textContent = '流程图语法有误，请点击“编辑源码”检查。'
    })
  }

  toolbar.append(label, actionGroup)
  dom.append(toolbar, preview, source)
  renderPreview(node)

  return {
    dom,
    contentDOM: source,
    update: (nextNode: ProseMirrorNode) => {
      if (nextNode.type !== node.type) return false
      if (nextNode.attrs.language?.trim().toLowerCase() !== 'mermaid') return false
      if (nextNode.eq(renderedNode)) return true
      renderedNode = nextNode
      renderPreview(nextNode)
      return true
    },
    destroy: () => {
      // 文档切换/节点销毁时作废进行中的 mermaid 渲染，避免在已分离 DOM 上继续写入
      renderVersion += 1
    },
    ignoreMutation: (mutation: MutationRecord) => {
      if (mutation.type === 'selection') return false
      return !source.contains(mutation.target)
    },
  }
}

const MarkdownEditorImpl = forwardRef<EditorCommands, MarkdownEditorProps>(function MarkdownEditor(
  { markdown, mode, workspaceRoot, scrollPositionKey, onMarkdownChange, onSourceChange, onCursorChange, onDropImage, onOpenPreview, onNavigateLink, onTriggerAiAction, onRunCode },
  ref,
) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const sourceGutterRef = useRef<HTMLDivElement>(null)
  const cursorFrameRef = useRef<number | null>(null)
  const lastEditorMarkdownRef = useRef(markdown)
  const onMarkdownChangeRef = useRef(onMarkdownChange)
  const onSourceChangeRef = useRef(onSourceChange)
  const onDropImageRef = useRef(onDropImage)
  const onOpenPreviewRef = useRef(onOpenPreview)
  const onNavigateLinkRef = useRef(onNavigateLink)
  const onTriggerAiActionRef = useRef(onTriggerAiAction)
  const onRunCodeRef = useRef(onRunCode)
  const workspaceRootRef = useRef(workspaceRoot)
  onMarkdownChangeRef.current = onMarkdownChange
  onSourceChangeRef.current = onSourceChange
  onDropImageRef.current = onDropImage
  onOpenPreviewRef.current = onOpenPreview
  onNavigateLinkRef.current = onNavigateLink
  onTriggerAiActionRef.current = onTriggerAiAction
  onRunCodeRef.current = onRunCode
  workspaceRootRef.current = workspaceRoot
  const scrollPositionKeyRef = useRef(scrollPositionKey)
  scrollPositionKeyRef.current = scrollPositionKey

  const lowlight = useMemo(() => createLowlight(common), [])
  const extensions = useMemo(() => [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    CodeBlockLowlight.configure({ lowlight }).extend({
      addNodeView() {
        return ({ node }) => {
          if (node.attrs.language?.trim().toLowerCase() === 'mermaid') {
            return createMermaidNodeView(node, (previewData) => onOpenPreviewRef.current(previewData))
          }

          let currentNode = node
          let renderedNode = node

          const dom = document.createElement('div')
          dom.className = 'code-block-wrapper'

          const pre = document.createElement('pre')

          const gutter = document.createElement('div')
          gutter.className = 'code-line-numbers'
          gutter.setAttribute('aria-hidden', 'true')
          gutter.setAttribute('contenteditable', 'false')

          const code = document.createElement('code')
          code.className = node.attrs.language ? `language-${node.attrs.language}` : ''
          code.setAttribute('spellcheck', 'false')

          const toolbar = document.createElement('div')
          toolbar.className = 'code-block-toolbar'
          toolbar.setAttribute('contenteditable', 'false')

          const langBadge = document.createElement('span')
          langBadge.className = 'code-lang-badge'
          langBadge.textContent = formatLanguage(node.attrs.language)

          const runButton = document.createElement('button')
          runButton.type = 'button'
          runButton.className = 'code-action-button code-run-btn'
          runButton.setAttribute('contenteditable', 'false')
          runButton.textContent = '▶ 运行'

          const copyButton = document.createElement('button')
          copyButton.type = 'button'
          copyButton.className = 'code-action-button code-copy-button'
          copyButton.setAttribute('aria-label', '复制代码')
          copyButton.setAttribute('contenteditable', 'false')
          copyButton.textContent = '📋 复制'
          copyButton.addEventListener('mousedown', (event) => event.preventDefault())
          copyButton.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            void copyText(code.textContent ?? '').then(() => {
              copyButton.textContent = '已复制'
              window.setTimeout(() => { copyButton.textContent = '📋 复制' }, 1200)
            }).catch(() => {
              copyButton.textContent = '复制失败'
              window.setTimeout(() => { copyButton.textContent = '📋 复制' }, 1200)
            })
          })

          toolbar.append(langBadge, runButton, copyButton)
          pre.append(gutter, code, toolbar)
          dom.append(pre)

          const triggerRun = () => {
            const snippet = currentNode.textContent || code.textContent || ''
            if (!snippet.trim()) return
            onRunCodeRef.current?.(currentNode.attrs.language || 'text', snippet, workspaceRootRef.current || undefined)
          }

          runButton.addEventListener('mousedown', (event) => event.preventDefault())
          runButton.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            triggerRun()
          })
          code.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              triggerRun()
            }
          })

          const updateLineNumbers = (currentNode: typeof node) => {
            const lines = currentNode.textContent.split(/\r?\n/)
            const lineCount = Math.max(1, lines.at(-1) === '' ? lines.length - 1 : lines.length)
            gutter.replaceChildren(...Array.from({ length: lineCount }, (_, index) => {
              const lineNumber = document.createElement('span')
              lineNumber.textContent = String(index + 1)
              return lineNumber
            }))
            code.className = currentNode.attrs.language ? `language-${currentNode.attrs.language}` : ''
          }

          updateLineNumbers(node)

          return {
            dom,
            contentDOM: code,
            update: (nextNode: typeof node) => {
              if (nextNode.type !== node.type) return false
              if (nextNode.attrs.language?.trim().toLowerCase() === 'mermaid') return false
              currentNode = nextNode
              langBadge.textContent = formatLanguage(nextNode.attrs.language)
              if (nextNode.eq(renderedNode)) return true
              renderedNode = nextNode
              updateLineNumbers(nextNode)
              return true
            },
            ignoreMutation: (mutation: MutationRecord) => {
              if (mutation.type === 'selection') return false
              return !code.contains(mutation.target)
            },
            destroy: () => {
              // 运行已迁移至代码运行对话框；无内嵌进程需要在此取消
            },
          }
        }
      },
    }),
    Markdown,
    Image.configure({ allowBase64: true }),
    Placeholder.configure({ placeholder: '开始写作，输入 # 创建标题…' }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Typography,
    Highlight,
    Mathematics.configure({
      katex: {
        throwOnError: false,
      },
    }),
  ], [lowlight])

  const editor = useEditor({
    extensions,
    content: markdownForEditor(markdown, workspaceRoot),
    contentType: 'markdown',
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        spellcheck: 'true',
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target
          if (!(target instanceof Element)) return false

          const link = target.closest('a')
          if (link instanceof HTMLAnchorElement) {
            const href = link.getAttribute('href')
            if (href) {
              event.preventDefault()
              event.stopPropagation()
              onNavigateLinkRef.current?.(href)
              return true
            }
          }

          const image = target.closest('img')
          if (image instanceof HTMLImageElement) {
            event.preventDefault()
            onOpenPreviewRef.current({ kind: 'image', src: image.currentSrc || image.src, alt: image.alt || '图片' })
            return true
          }

          const diagram = target.closest('[data-diagram="mermaid"]')
          const svg = diagram?.querySelector('svg')
          if (svg instanceof SVGElement) {
            event.preventDefault()
            const { markup, width, height } = prepareSvgForPreview(svg)
            onOpenPreviewRef.current({ kind: 'svg', markup, title: '流程图', width, height })
            return true
          }

          return false
        },
        contextmenu: (view, event) => {
          event.preventDefault()
          const target = event.target
          if (!(target instanceof Element)) return false

          const { from, to, empty } = view.state.selection
          const selectedText = empty ? '' : view.state.doc.textBetween(from, to, ' ')
          const cell = target.closest('td, th')
          const link = target.closest('a')
          const img = target.closest('img')
          const diagram = target.closest('[data-diagram="mermaid"]')

          const items: ContextMenuItem[] = []

          // 1. 文本选中状态：AI 创作与格式化
          if (selectedText.trim()) {
            items.push(
              { type: 'header', label: 'AI 智能创作', icon: <Sparkles size={14} /> },
              {
                id: 'ai-polish',
                label: 'AI 润色优化',
                icon: <Sparkles size={14} />,
                onClick: () => onTriggerAiActionRef.current?.('polish', selectedText),
              },
              {
                id: 'ai-expand',
                label: 'AI 扩写丰富',
                icon: <Sparkles size={14} />,
                onClick: () => onTriggerAiActionRef.current?.('expand', selectedText),
              },
              {
                id: 'ai-shorten',
                label: '精简摘要',
                icon: <Sparkles size={14} />,
                onClick: () => onTriggerAiActionRef.current?.('shorten', selectedText),
              },
              {
                id: 'ai-translate',
                label: '中英双向翻译',
                icon: <Sparkles size={14} />,
                onClick: () => onTriggerAiActionRef.current?.('translate', selectedText),
              },
              {
                id: 'ai-proofread',
                label: '错别字与语法纠错',
                icon: <Sparkles size={14} />,
                onClick: () => onTriggerAiActionRef.current?.('proofread', selectedText),
              },
              {
                id: 'ai-qa',
                label: '向 AI 提问此内容…',
                icon: <Sparkles size={14} />,
                onClick: () => onTriggerAiActionRef.current?.('qa', selectedText),
              },
              { type: 'separator' },
              {
                id: 'cut',
                label: '剪切',
                icon: <Scissors size={14} />,
                shortcut: 'Ctrl+X',
                onClick: () => {
                  void copyText(selectedText)
                  view.dispatch(view.state.tr.deleteSelection())
                },
              },
              {
                id: 'copy',
                label: '复制',
                icon: <Copy size={14} />,
                shortcut: 'Ctrl+C',
                onClick: () => void copyText(selectedText),
              },
              { type: 'separator' },
              {
                id: 'bold',
                label: '加粗',
                icon: <Bold size={14} />,
                shortcut: 'Ctrl+B',
                onClick: () => editor?.chain().focus().toggleBold().run(),
              },
              {
                id: 'italic',
                label: '斜体',
                icon: <Italic size={14} />,
                shortcut: 'Ctrl+I',
                onClick: () => editor?.chain().focus().toggleItalic().run(),
              },
              {
                id: 'code',
                label: '行内代码',
                icon: <Code size={14} />,
                shortcut: 'Ctrl+E',
                onClick: () => editor?.chain().focus().toggleCode().run(),
              },
              {
                id: 'h1',
                label: '设为一级标题',
                icon: <Heading1 size={14} />,
                shortcut: 'Ctrl+Alt+1',
                onClick: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
              },
              {
                id: 'h2',
                label: '设为二级标题',
                icon: <Heading2 size={14} />,
                shortcut: 'Ctrl+Alt+2',
                onClick: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
              },
            )
          } else if (cell instanceof HTMLElement) {
            // 2. 表格单元格上下文
            const position = Math.min(view.posAtDOM(cell, 0) + 1, view.state.doc.content.size)
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))))

            items.push(
              { type: 'header', label: '表格操作', icon: <TableIcon size={14} /> },
              {
                id: 'table-add-row-before',
                label: '上方插入行',
                onClick: () => editor?.chain().focus().addRowBefore().run(),
              },
              {
                id: 'table-add-row-after',
                label: '下方插入行',
                onClick: () => editor?.chain().focus().addRowAfter().run(),
              },
              {
                id: 'table-del-row',
                label: '删除当前行',
                onClick: () => editor?.chain().focus().deleteRow().run(),
              },
              { type: 'separator' },
              {
                id: 'table-add-col-before',
                label: '左侧插入列',
                onClick: () => editor?.chain().focus().addColumnBefore().run(),
              },
              {
                id: 'table-add-col-after',
                label: '右侧插入列',
                onClick: () => editor?.chain().focus().addColumnAfter().run(),
              },
              {
                id: 'table-del-col',
                label: '删除当前列',
                onClick: () => editor?.chain().focus().deleteColumn().run(),
              },
              { type: 'separator' },
              {
                id: 'table-merge',
                label: '合并/拆分单元格',
                onClick: () => {
                  if (editor?.can().mergeCells()) editor.chain().focus().mergeCells().run()
                  else editor?.chain().focus().splitCell().run()
                },
              },
              {
                id: 'table-header',
                label: '切换标题行',
                onClick: () => editor?.chain().focus().toggleHeaderRow().run(),
              },
              { type: 'separator' },
              {
                id: 'table-delete',
                label: '删除表格',
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: () => editor?.chain().focus().deleteTable().run(),
              },
            )
          } else if (link instanceof HTMLAnchorElement) {
            // 3. 超链接上下文
            const href = link.getAttribute('href') || ''
            items.push(
              { type: 'header', label: '超链接', icon: <Link size={14} /> },
              {
                id: 'open-link',
                label: '打开链接',
                icon: <ExternalLink size={14} />,
                onClick: () => onNavigateLinkRef.current?.(href),
              },
              {
                id: 'copy-link',
                label: '复制链接地址',
                icon: <Copy size={14} />,
                onClick: () => void copyText(href),
              },
              {
                id: 'remove-link',
                label: '取消超链接',
                icon: <Unlink size={14} />,
                onClick: () => editor?.chain().focus().unsetLink().run(),
              },
            )
          } else if (img instanceof HTMLImageElement) {
            // 4. 图片上下文
            const src = img.currentSrc || img.src
            const alt = img.alt || '图片'
            items.push(
              { type: 'header', label: '图片', icon: <ImageIcon size={14} /> },
              {
                id: 'preview-image',
                label: '查看大图',
                icon: <Maximize2 size={14} />,
                onClick: () => onOpenPreviewRef.current({ kind: 'image', src, alt }),
              },
              {
                id: 'copy-image-md',
                label: '复制图片 Markdown 引用',
                icon: <Copy size={14} />,
                onClick: () => void copyText(`![${alt}](${img.getAttribute('src') || src})`),
              },
            )
          } else if (diagram instanceof HTMLElement) {
            // 5. 流程图上下文
            const svg = diagram.querySelector('svg')
            items.push(
              { type: 'header', label: '流程图', icon: <Workflow size={14} /> },
              ...(svg instanceof SVGElement ? [{
                id: 'preview-diagram',
                label: '全屏查看流程图',
                icon: <Maximize2 size={14} />,
                onClick: () => {
                  const { markup, width, height } = prepareSvgForPreview(svg)
                  onOpenPreviewRef.current({ kind: 'svg', markup, title: '流程图', width, height })
                },
              }] : []),
            )
          } else {
            // 6. 普通光标处（插入与常用工具）
            items.push(
              {
                id: 'paste',
                label: '粘贴',
                shortcut: 'Ctrl+V',
                onClick: async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text) editor?.chain().focus().insertContent(text).run()
                  } catch {
                    // ignore
                  }
                },
              },
              { type: 'separator' },
              { type: 'header', label: '快速插入' },
              {
                id: 'insert-table',
                label: '插入表格 (3×3)',
                icon: <TableIcon size={14} />,
                onClick: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
              },
              {
                id: 'insert-code',
                label: '插入代码块',
                icon: <Code size={14} />,
                onClick: () => editor?.chain().focus().toggleCodeBlock().run(),
              },
              {
                id: 'insert-mermaid',
                label: '插入流程图 (Mermaid)',
                icon: <Workflow size={14} />,
                onClick: () => editor?.chain().focus().insertContent('\n```mermaid\ngraph TD\n  A[开始] --> B(处理步骤)\n  B --> C{是否完成}\n  C -->|是| D[结束]\n  C -->|否| B\n```\n').run(),
              },
              {
                id: 'insert-math',
                label: '插入数学公式 (KaTeX)',
                onClick: () => editor?.chain().focus().insertContent('$$\nE = mc^2\n$$\n').run(),
              },
              {
                id: 'insert-hr',
                label: '插入分割线',
                onClick: () => editor?.chain().focus().setHorizontalRule().run(),
              },
              {
                id: 'insert-quote',
                label: '插入引用块',
                onClick: () => editor?.chain().focus().toggleBlockquote().run(),
              },
              { type: 'separator' },
              {
                id: 'undo',
                label: '撤销',
                icon: <Undo2 size={14} />,
                shortcut: 'Ctrl+Z',
                onClick: () => editor?.chain().focus().undo().run(),
              },
              {
                id: 'redo',
                label: '重做',
                icon: <Redo2 size={14} />,
                shortcut: 'Ctrl+Y',
                onClick: () => editor?.chain().focus().redo().run(),
              },
              {
                id: 'select-all',
                label: '全选',
                shortcut: 'Ctrl+A',
                onClick: () => editor?.chain().focus().selectAll().run(),
              },
            )
          }

          setContextMenu({ x: event.clientX, y: event.clientY, items })
          return true
        },
        drop: (_view, event) => {
          const file = event.dataTransfer?.files[0]
          if (!file?.path || !file.type.startsWith('image/')) return false
          event.preventDefault()
          onDropImageRef.current(file.path)
          return true
        },
        paste: (_view, event) => {
          const file = Array.from(event.clipboardData?.files ?? [])[0]
          if (!file?.path || !file.type.startsWith('image/')) return false
          event.preventDefault()
          onDropImageRef.current(file.path)
          return true
        },
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const nextMarkdown = markdownFromEditor(updatedEditor.getMarkdown(), workspaceRootRef.current)
      lastEditorMarkdownRef.current = nextMarkdown
      onMarkdownChangeRef.current(nextMarkdown)
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      if (cursorFrameRef.current !== null) return
      cursorFrameRef.current = window.requestAnimationFrame(() => {
        cursorFrameRef.current = null
        const position = updatedEditor.state.selection.from
        const textBefore = updatedEditor.state.doc.textBetween(0, position, '\n', '\n')
        const lines = textBefore.split('\n')
        onCursorChange({ line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 })
      })
    },
  })

  const getScrollTarget = useCallback((): HTMLElement | null => {
    if (!scrollPositionKeyRef.current) return null
    if (mode === 'source') return sourceRef.current
    const dom = editor?.view.dom
    return dom ? (dom.closest('.editor-scroll') as HTMLElement | null) : null
  }, [editor, mode])

  // 滚动位置持久化：当前文档滚动时（rAF 节流）记录到 localStorage，按文档路径独立保存
  useEffect(() => {
    if (!scrollPositionKey) return
    const key = `markdown-desk-scroll:${scrollPositionKey.toLowerCase().replace(/\\/g, '/')}`
    const target = getScrollTarget()
    if (!target) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const max = target.scrollHeight - target.clientHeight
        const ratio = max > 0 ? target.scrollTop / max : 0
        try {
          localStorage.setItem(key, String(Math.round(ratio * 10000) / 10000))
        } catch { /* localStorage 不可用则忽略 */ }
      })
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [scrollPositionKey, getScrollTarget])

  // 滚动位置恢复：切换文档/载入内容后延时多次应用，等待图片、Mermaid 等异步渲染抬高文档高度
  useEffect(() => {
    if (!scrollPositionKey) return
    let saved: number | null = null
    try {
      const raw = localStorage.getItem(`markdown-desk-scroll:${scrollPositionKey.toLowerCase().replace(/\\/g, '/')}`)
      const parsed = raw == null ? Number.NaN : Number.parseFloat(raw)
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) saved = parsed
    } catch { /* localStorage 不可用则忽略 */ }
    if (saved == null) return

    let cancelled = false
    const timers: number[] = []
    const apply = () => {
      if (cancelled) return
      const target = getScrollTarget()
      if (!target) return
      const previousBehavior = target.style.scrollBehavior
      target.style.scrollBehavior = 'auto'
      // 先跳到底部强制浏览器完成内容测量（content-visibility 惰性测量会导致 scrollHeight 偏低），
      // 再按比例落位到阅读位置
      target.scrollTop = target.scrollHeight
      target.scrollTop = (target.scrollHeight - target.clientHeight) * saved
      target.style.scrollBehavior = previousBehavior
    }
    ;[60, 300, 800, 1500, 2400].forEach((delay) => {
      timers.push(window.setTimeout(apply, delay))
    })
    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [scrollPositionKey, getScrollTarget])

  useEffect(() => () => {
    if (cursorFrameRef.current !== null) window.cancelAnimationFrame(cursorFrameRef.current)
  }, [])

  useEffect(() => {
    if (mode === 'source') setContextMenu(null)
  }, [mode])

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [])

  useEffect(() => {
    if (!editor || mode !== 'wysiwyg') return
    if (lastEditorMarkdownRef.current === markdown) return
    try {
      editor.commands.setContent(markdownForEditor(markdown, workspaceRoot), { emitUpdate: false, contentType: 'markdown' })
      lastEditorMarkdownRef.current = markdown
    } catch (error) {
      // 切换文档/载入内容解析失败：保留旧文档，避免渲染进程处于不一致状态；同时上报以便排查
      void window.desktop?.logToFile?.('error', 'Markdown 解析失败（setContent）', {
        message: error instanceof Error ? error.message : String(error),
        markdownChars: markdown.length,
        workspaceRoot,
      }).catch(() => undefined)
    }
  }, [editor, markdown, mode, workspaceRoot])

  const getHtmlForExport = useCallback(async () => {
    const container = document.createElement('div')
    container.className = 'tiptap-editor docx-export-snapshot'
    container.style.cssText = 'position:fixed;left:-100000px;top:0;width:880px;min-height:0;padding:48px;box-sizing:border-box;background:#fff;color:#24272b;font-family:Inter,"Microsoft YaHei",sans-serif;line-height:1.8;'
    container.innerHTML = editor?.getHTML() ?? ''
    document.body.append(container)

    try {
      const mermaidBlocks = Array.from(container.querySelectorAll('pre > code.language-mermaid'))
      for (const code of mermaidBlocks) {
        try {
          const { svg } = await mermaid.render(`mermaid-export-${++mermaidDiagramId}`, code.textContent ?? '')
          const diagram = document.createElement('div')
          diagram.className = 'mermaid-export'
          diagram.innerHTML = svg
          code.closest('pre')?.replaceWith(diagram)
        } catch {
          // Keep the source block in the export when a diagram cannot be rendered.
        }
      }

      await renderMathForExport(container)
      return container.innerHTML
    } finally {
      container.remove()
    }
  }, [editor])

  const getHtmlForDocx = useCallback(async () => {
    const snapshot = document.createElement('div')
    snapshot.className = 'tiptap-editor docx-export-snapshot'
    snapshot.style.cssText = 'position:fixed;left:-100000px;top:0;width:880px;min-height:0;padding:48px;box-sizing:border-box;background:#fff;color:#24272b;font-family:Inter,"Microsoft YaHei",sans-serif;line-height:1.8;'
    snapshot.innerHTML = await getHtmlForExport()
    document.body.append(snapshot)

    try {
      await document.fonts.ready
      const diagrams = Array.from(snapshot.querySelectorAll<SVGElement>('.mermaid-export svg'))
      for (const svg of diagrams) {
        const bounds = svg.getBoundingClientRect()
        const svgForWord = svg.cloneNode(true) as SVGElement
        svgForWord.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        svgForWord.setAttribute('width', String(Math.max(1, Math.ceil(bounds.width))))
        svgForWord.setAttribute('height', String(Math.max(1, Math.ceil(bounds.height))))
        const dataUrl = `data:image/svg+xml;base64,${toBase64Utf8(svgForWord.outerHTML)}`
        const image = document.createElement('img')
        image.src = dataUrl
        image.alt = '流程图'
        image.width = Math.max(1, Math.ceil(bounds.width))
        image.height = Math.max(1, Math.ceil(bounds.height))
        image.style.cssText = `display:block;width:${Math.min(bounds.width, 880)}px;max-width:100%;height:auto;margin:1.5em auto;`
        svg.replaceWith(image)
      }

      return snapshot.innerHTML
    } finally {
      snapshot.remove()
    }
  }, [getHtmlForExport])

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (mode === 'source') sourceRef.current?.focus()
      else editor?.commands.focus()
    },
    loadMarkdown: (nextMarkdown) => {
      lastEditorMarkdownRef.current = nextMarkdown
      editor?.commands.setContent(markdownForEditor(nextMarkdown, workspaceRoot), { emitUpdate: false, contentType: 'markdown' })
    },
    getHtml: () => editor?.getHTML() ?? '',
    getHtmlForExport,
    getHtmlForDocx,
    toggleBold: () => editor?.chain().focus().toggleBold().run(),
    toggleItalic: () => editor?.chain().focus().toggleItalic().run(),
    toggleStrike: () => editor?.chain().focus().toggleStrike().run(),
    toggleInlineCode: () => editor?.chain().focus().toggleCode().run(),
    setHeading: (level) => editor?.chain().focus().toggleHeading({ level }).run(),
    setParagraph: () => editor?.chain().focus().setParagraph().run(),
    setLink: (url) => editor?.chain().focus().setLink({ href: url }).run(),
    insertTable: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    toggleBulletList: () => editor?.chain().focus().toggleBulletList().run(),
    toggleOrderedList: () => editor?.chain().focus().toggleOrderedList().run(),
    toggleTaskList: () => editor?.chain().focus().toggleTaskList().run(),
    toggleBlockquote: () => editor?.chain().focus().toggleBlockquote().run(),
    toggleCodeBlock: () => editor?.chain().focus().toggleCodeBlock().run(),
    insertHorizontalRule: () => editor?.chain().focus().setHorizontalRule().run(),
    insertImage: (source, alt) => editor?.chain().focus().setImage({ src: source, alt }).run(),
    getSelection: () => {
      if (mode === 'source') {
        const source = sourceRef.current
        if (!source || source.selectionStart === source.selectionEnd) return null
        const text = source.value.slice(source.selectionStart, source.selectionEnd)
        if (!text.trim()) return null
        const textBefore = source.value.slice(0, source.selectionStart)
        const startLine = textBefore.split('\n').length
        return {
          text,
          startLine,
          endLine: startLine + text.split('\n').length - 1,
        }
      }
      if (!editor) return null
      const { from, to } = editor.state.selection
      if (from === to) return null
      const text = editor.state.doc.textBetween(from, to, '\n', '\n')
      if (!text.trim()) return null
      const textBefore = editor.state.doc.textBetween(0, from, '\n', '\n')
      const startLine = textBefore.split('\n').length
      return {
        text,
        startLine,
        endLine: startLine + text.split('\n').length - 1,
      }
    },
    replaceSelection: (replacement) => {
      if (mode === 'source') {
        const source = sourceRef.current
        if (!source) return
        const start = source.selectionStart
        const end = source.selectionEnd
        onSourceChangeRef.current(`${source.value.slice(0, start)}${replacement}${source.value.slice(end)}`)
        window.requestAnimationFrame(() => {
          source.focus()
          source.setSelectionRange(start, start + replacement.length)
        })
        return
      }
      editor?.chain().focus().deleteSelection().insertContent(replacement, { contentType: 'markdown' }).run()
    },
    replaceDocument: (replacement) => {
      if (mode === 'source') {
        const source = sourceRef.current
        if (!source) return
        onSourceChangeRef.current(replacement)
        window.requestAnimationFrame(() => source.focus())
        return
      }
      editor?.chain().focus().selectAll().insertContent(replacement, { contentType: 'markdown' }).run()
    },
    selectLine: (line) => {
      if (mode === 'source') {
        const source = sourceRef.current
        if (!source) return
        selectSourceLine(source, line)
        return
      }
      if (!editor) return
      let currentLine = 1
      let targetPosition = editor.state.doc.content.size
      let targetElement: HTMLElement | null = null
      editor.state.doc.descendants((node, position) => {
        if (currentLine >= line) {
          targetPosition = position
          const domNode = editor.view.nodeDOM(position)
          targetElement = domNode instanceof HTMLElement ? domNode : domNode?.parentElement instanceof HTMLElement ? domNode.parentElement : null
          return false
        }
        currentLine += Math.max(1, node.textContent.split('\n').length)
        return true
      })
      editor.commands.setTextSelection(Math.min(targetPosition + 1, editor.state.doc.content.size))
      editor.commands.focus()
      window.requestAnimationFrame(() => {
        targetElement?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        })
      })
    },
    selectHeading: (headingIndex, sourceLine) => {
      if (mode === 'source') {
        const source = sourceRef.current
        if (!source) return
        selectSourceLine(source, sourceLine)
        return
      }
      if (!editor) return
      let currentHeading = 0
      let targetPosition: number | null = null
      editor.state.doc.descendants((node, position) => {
        if (node.type.name !== 'heading') return true
        if (currentHeading === headingIndex) {
          targetPosition = position
          return false
        }
        currentHeading += 1
        return true
      })
      if (targetPosition === null) return

      editor.commands.setTextSelection(Math.min(targetPosition + 1, editor.state.doc.content.size))
      editor.commands.focus()
      window.requestAnimationFrame(() => {
        const heading = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))[headingIndex]
        if (!(heading instanceof HTMLElement)) return
        heading.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        })
      })
    },
  }), [editor, getHtmlForDocx, getHtmlForExport, mode, workspaceRoot])

  if (mode === 'source') {
    const lineCount = Math.max(1, markdown.split(/\r?\n/).length)
    return (
      <div className="source-editor-wrap">
        <div ref={sourceGutterRef} className="source-line-numbers" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <textarea
          ref={sourceRef}
          className="source-editor"
          value={markdown}
          aria-label="Markdown 源码编辑器"
          spellCheck="false"
          wrap="off"
          onChange={(event) => onSourceChange(event.target.value)}
          onScroll={(event) => {
            if (sourceGutterRef.current) sourceGutterRef.current.scrollTop = event.currentTarget.scrollTop
          }}
          onSelect={(event) => {
            const textarea = event.currentTarget
            const textBefore = textarea.value.slice(0, textarea.selectionStart)
            const lines = textBefore.split('\n')
            onCursorChange({ line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 })
          }}
        />
      </div>
    )
  }

  return (
    <div className="editor-content-wrap">
      <EditorContent editor={editor} />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
})

export const MarkdownEditor = memo(MarkdownEditorImpl)
