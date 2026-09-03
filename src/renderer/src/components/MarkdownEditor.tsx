import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
import mermaid from 'mermaid'
import { common, createLowlight } from 'lowlight'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { AiSelection, MarkdownMode } from '@shared/types'
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
  onMarkdownChange: (markdown: string) => void
  onSourceChange: (markdown: string) => void
  onCursorChange: (cursor: { line: number; column: number }) => void
  onDropImage: (sourcePath: string) => void
  onOpenPreview: (preview: EditorPreview) => void
  onNavigateLink?: (href: string) => void
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

let mermaidDiagramId = 0

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
    ignoreMutation: (mutation: MutationRecord) => {
      if (mutation.type === 'selection') return false
      return !source.contains(mutation.target)
    },
  }
}

const MarkdownEditorImpl = forwardRef<EditorCommands, MarkdownEditorProps>(function MarkdownEditor(
  { markdown, mode, workspaceRoot, onMarkdownChange, onSourceChange, onCursorChange, onDropImage, onOpenPreview, onNavigateLink },
  ref,
) {
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const sourceGutterRef = useRef<HTMLDivElement>(null)
  const cursorFrameRef = useRef<number | null>(null)
  const lastEditorMarkdownRef = useRef(markdown)
  const onMarkdownChangeRef = useRef(onMarkdownChange)
  const onSourceChangeRef = useRef(onSourceChange)
  const onDropImageRef = useRef(onDropImage)
  const onOpenPreviewRef = useRef(onOpenPreview)
  const onNavigateLinkRef = useRef(onNavigateLink)
  const workspaceRootRef = useRef(workspaceRoot)
  onMarkdownChangeRef.current = onMarkdownChange
  onSourceChangeRef.current = onSourceChange
  onDropImageRef.current = onDropImage
  onOpenPreviewRef.current = onOpenPreview
  onNavigateLinkRef.current = onNavigateLink
  workspaceRootRef.current = workspaceRoot

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

          const dom = document.createElement('pre')
          const gutter = document.createElement('div')
          const code = document.createElement('code')
          const copyButton = document.createElement('button')

          gutter.className = 'code-line-numbers'
          gutter.setAttribute('aria-hidden', 'true')
          gutter.setAttribute('contenteditable', 'false')
          code.className = node.attrs.language ? `language-${node.attrs.language}` : ''
          code.setAttribute('spellcheck', 'false')
          copyButton.type = 'button'
          copyButton.className = 'code-copy-button'
          copyButton.setAttribute('aria-label', '复制代码')
          copyButton.setAttribute('contenteditable', 'false')
          copyButton.textContent = '复制'
          copyButton.addEventListener('mousedown', (event) => event.preventDefault())
          copyButton.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            void copyText(code.textContent ?? '').then(() => {
              copyButton.textContent = '已复制'
              window.setTimeout(() => { copyButton.textContent = '复制' }, 1200)
            }).catch(() => {
              copyButton.textContent = '复制失败'
              window.setTimeout(() => { copyButton.textContent = '复制' }, 1200)
            })
          })

          let renderedNode = node

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
          dom.append(gutter, code, copyButton)

          return {
            dom,
            contentDOM: code,
            update: (nextNode: typeof node) => {
              if (nextNode.type !== node.type) return false
              if (nextNode.attrs.language?.trim().toLowerCase() === 'mermaid') return false
              if (nextNode.eq(renderedNode)) return true
              renderedNode = nextNode
              updateLineNumbers(nextNode)
              return true
            },
            ignoreMutation: (mutation: MutationRecord) => {
              if (mutation.type === 'selection') return false
              return !code.contains(mutation.target)
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
          const target = event.target
          if (!(target instanceof Element)) return false
          const cell = target.closest('td, th')
          if (!(cell instanceof HTMLElement)) return false

          const position = Math.min(view.posAtDOM(cell, 0) + 1, view.state.doc.content.size)
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))))
          event.preventDefault()
          setTableMenu({ x: event.clientX, y: event.clientY })
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

  useEffect(() => () => {
    if (cursorFrameRef.current !== null) window.cancelAnimationFrame(cursorFrameRef.current)
  }, [])

  useEffect(() => {
    if (mode === 'source') setTableMenu(null)
  }, [mode])

  useEffect(() => {
    const closeMenu = () => setTableMenu(null)
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

    editor.commands.setContent(markdownForEditor(markdown, workspaceRoot), { emitUpdate: false, contentType: 'markdown' })
    lastEditorMarkdownRef.current = markdown
  }, [editor, markdown, mode, workspaceRoot])

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
  }), [editor, mode, workspaceRoot])

  const runTableAction = (action: () => boolean | undefined) => {
    action()
    setTableMenu(null)
  }

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
      {tableMenu && (
        <div
          className="table-context-menu"
          role="menu"
          aria-label="表格操作"
          style={{ left: Math.max(8, Math.min(tableMenu.x, window.innerWidth - 220)), top: Math.max(8, Math.min(tableMenu.y, window.innerHeight - 370)) }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().addRowBefore().run())}>上方插入行</button>
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().addRowAfter().run())}>下方插入行</button>
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().deleteRow().run())}>删除当前行</button>
          <div className="table-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().addColumnBefore().run())}>左侧插入列</button>
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().addColumnAfter().run())}>右侧插入列</button>
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().deleteColumn().run())}>删除当前列</button>
          <div className="table-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().mergeCells().run())}>合并单元格</button>
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().splitCell().run())}>拆分单元格</button>
          <button type="button" role="menuitem" onClick={() => runTableAction(() => editor?.chain().focus().toggleHeaderRow().run())}>切换标题行</button>
          <div className="table-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => runTableAction(() => editor?.chain().focus().deleteTable().run())}>删除表格</button>
        </div>
      )}
    </div>
  )
})

export const MarkdownEditor = memo(MarkdownEditorImpl)
