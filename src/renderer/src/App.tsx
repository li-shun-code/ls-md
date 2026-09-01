import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'
import { ChevronLeft, Code2, FileText, FolderOpen, PanelLeft, Search, Sparkles } from 'lucide-react'
import type { FileNode, MenuCommand, MarkdownMode, OpenedDocument, WorkspaceSelection } from '@shared/types'
import { FileTree } from '@renderer/components/FileTree'
import { IconButton } from '@renderer/components/IconButton'
import { MarkdownEditor, type EditorCommands, type EditorPreview } from '@renderer/components/MarkdownEditor'
import { AiPanel } from '@renderer/components/AiPanel'
import { Outline } from '@renderer/components/Outline'
import {
  buildExportHtml,
  countDocument,
  extractOutline,
  markdownFromEditor,
} from '@renderer/utils/markdown'
import type { OutlineItem } from '@renderer/utils/markdown'
import './styles.css'

type SidebarTab = 'files' | 'outline'
type Theme = 'light' | 'dark'

export function App() {
  const editorRef = useRef<EditorCommands>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [activePath, setActivePath] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [savedMarkdown, setSavedMarkdown] = useState('')
  const [mode, setMode] = useState<MarkdownMode>('wysiwyg')
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('outline')
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('markdown-desk-sidebar') !== 'closed')
  const [aiOpen, setAiOpen] = useState(() => localStorage.getItem('markdown-desk-ai-panel') === 'open')
  const [focusMode, setFocusMode] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('markdown-desk-theme') as Theme | null) ?? 'light')
  const [zoom, setZoom] = useState(1)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<EditorPreview | null>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [recentPaths, setRecentPaths] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('markdown-desk-recent') ?? '[]') as string[] } catch { return [] }
  })

  const deferredMarkdown = useDeferredValue(markdown)
  const outline = useMemo(() => extractOutline(deferredMarkdown), [deferredMarkdown])
  const stats = useMemo(() => countDocument(deferredMarkdown), [deferredMarkdown])
  const dirty = markdown !== savedMarkdown
  const documentTitle = activePath ? activePath.split(/[\\/]/).pop() ?? '未命名文档' : '未命名文档'

  const autoOpenedRef = useRef(false)
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath

  const rememberRecent = useCallback((filePath: string) => {
    setRecentPaths((current) => {
      const next = [filePath, ...current.filter((item) => item !== filePath)].slice(0, 8)
      try { localStorage.setItem('markdown-desk-recent', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
    try { localStorage.setItem('markdown-desk-last-file', filePath) } catch { /* ignore */ }
  }, [])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 2800)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((current) => !current)
  }, [])

  const insertLink = useCallback(() => {
    if (mode !== 'wysiwyg') return
    const url = window.prompt('输入链接地址', 'https://')
    if (url) editorRef.current?.setLink(url)
  }, [mode])

  const [isPanning, setIsPanning] = useState(false)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)

  const handleOpenPreview = useCallback((nextPreview: EditorPreview) => {
    setPreviewZoom(1)
    setPreview(nextPreview)
  }, [])

  const changePreviewZoom = useCallback((delta: number) => {
    setPreviewZoom((current) => Math.round(Math.min(4, Math.max(0.5, current + delta)) * 100) / 100)
  }, [])

  const copyPreviewContent = useCallback(async () => {
    if (!preview) return
    try {
      if (preview.kind === 'svg') {
        await navigator.clipboard.writeText(preview.markup)
        showNotice('已复制流程图 SVG 源码')
      } else {
        await navigator.clipboard.writeText(preview.src)
        showNotice('已复制图片链接')
      }
    } catch {
      showNotice('复制失败')
    }
  }, [preview, showNotice])

  const handleStageMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const stage = previewStageRef.current
    if (!stage) return
    setIsPanning(true)
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
    }
  }, [])

  const handleStageMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!panStartRef.current || !previewStageRef.current) return
    event.preventDefault()
    const deltaX = event.clientX - panStartRef.current.x
    const deltaY = event.clientY - panStartRef.current.y
    previewStageRef.current.scrollLeft = panStartRef.current.scrollLeft - deltaX
    previewStageRef.current.scrollTop = panStartRef.current.scrollTop - deltaY
  }, [])

  const handleStageMouseUp = useCallback(() => {
    setIsPanning(false)
    panStartRef.current = null
  }, [])

  const zoomPreviewAtPoint = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const stage = event.currentTarget
    const rect = stage.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    setPreviewZoom((current) => {
      const next = Math.round(Math.min(4, Math.max(0.5, current + (event.deltaY < 0 ? 0.1 : -0.1))) * 100) / 100
      if (next === current) return current
      window.requestAnimationFrame(() => {
        const scale = next / current
        stage.scrollLeft = (stage.scrollLeft + pointerX) * scale - pointerX
        stage.scrollTop = (stage.scrollTop + pointerY) * scale - pointerY
      })
      return next
    })
  }, [])

  const refreshTree = useCallback(async (root: string) => {
    const nextTree = await window.desktop.listWorkspace(root)
    setFileTree(nextTree)
  }, [])

  const openDocument = useCallback(async (filePath: string, contentOverride?: string) => {
    if (dirty && !window.confirm('当前文档有未保存的修改，确定要切换文档吗？')) return

    try {
      const content = contentOverride ?? (await window.desktop.readMarkdown(filePath))
      const snapshot = await window.desktop.readRecovery(filePath)
      let nextContent = content

      if (snapshot && snapshot.markdown !== content) {
        const shouldRestore = window.confirm('发现这个文档的未保存恢复内容，要恢复它吗？')
        if (shouldRestore) nextContent = snapshot.markdown
        else await window.desktop.clearRecovery(filePath)
      }

      setActivePath(filePath)
      setWorkspaceRoot(filePath.replace(/[\\/][^\\/]+$/, ''))
      setMarkdown(nextContent)
      setSavedMarkdown(nextContent)
      setMode('wysiwyg')
      setCursor({ line: 1, column: 1 })
      rememberRecent(filePath)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开文档失败')
    }
  }, [dirty, rememberRecent, showNotice])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (autoOpenedRef.current || activePathRef.current) return
      autoOpenedRef.current = true
      const lastFile = localStorage.getItem('markdown-desk-last-file')
      if (lastFile) {
        window.desktop.readMarkdown(lastFile).then((content) => {
          if (!activePathRef.current) {
            void openDocument(lastFile, content)
          }
        }).catch(() => {
          try { localStorage.removeItem('markdown-desk-last-file') } catch { /* ignore */ }
        })
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [])

  const openRecent = useCallback(async (filePath: string) => {
    try {
      await window.desktop.openMarkdownPath(filePath)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '最近文件已无法打开')
    }
  }, [showNotice])

  const openWorkspace = useCallback(async () => {
    try {
      const root = await window.desktop.chooseWorkspace()
      if (!root) return
      setWorkspaceRoot(root)
      await refreshTree(root)
      showNotice(`已打开工作区：${root.split(/[\\/]/).pop() ?? root}`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开工作区失败')
    }
  }, [refreshTree, showNotice])

  const newDocument = useCallback(() => {
    if (dirty && !window.confirm('当前文档有未保存的修改，确定要新建文档吗？')) return
    setActivePath('')
    setMarkdown('')
    setSavedMarkdown('')
    setMode('wysiwyg')
    setCursor({ line: 1, column: 1 })
    window.setTimeout(() => editorRef.current?.focus(), 0)
  }, [dirty])

  const saveDocument = useCallback(async () => {
    try {
      const content = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
      if (!activePath) {
        const saved = await window.desktop.saveMarkdownAs('未命名.md', content)
        if (!saved) return
        setActivePath(saved.path)
        setWorkspaceRoot(saved.path.replace(/[\\/][^\\/]+$/, ''))
        setMarkdown(saved.content)
        setSavedMarkdown(saved.content)
        await window.desktop.clearRecovery(saved.path)
        showNotice('文档已保存')
        return
      }

      await window.desktop.writeMarkdown(activePath, content)
      setMarkdown(content)
      setSavedMarkdown(content)
      await window.desktop.clearRecovery(activePath)
      if (workspaceRoot) await refreshTree(workspaceRoot)
      showNotice('文档已保存')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '保存失败')
    }
  }, [activePath, markdown, mode, refreshTree, showNotice, workspaceRoot])

  const saveAs = useCallback(async () => {
    try {
      const content = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
      const saved = await window.desktop.saveMarkdownAs(activePath || '未命名.md', content)
      if (!saved) return
      setActivePath(saved.path)
      setWorkspaceRoot(saved.path.replace(/[\\/][^\\/]+$/, ''))
      setMarkdown(saved.content)
      setSavedMarkdown(saved.content)
      await window.desktop.clearRecovery(saved.path)
      showNotice('文档已另存为')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '另存为失败')
    }
  }, [activePath, markdown, mode, showNotice, workspaceRoot])

  const toggleMode = useCallback(() => {
    if (mode === 'source') {
      editorRef.current?.loadMarkdown(markdown)
      setMode('wysiwyg')
    } else {
      setMode('source')
    }
    window.setTimeout(() => editorRef.current?.focus(), 0)
  }, [markdown, mode])

  const exportDocument = useCallback(async (kind: 'html' | 'pdf') => {
    try {
      editorRef.current?.loadMarkdown(markdown)
      const body = editorRef.current?.getHtml() ?? ''
      const html = buildExportHtml(documentTitle, body)
      const exported = kind === 'html'
        ? await window.desktop.exportHtml(activePath || '未命名.md', html)
        : await window.desktop.exportPdf(activePath || '未命名.md', html)
      if (exported) showNotice(`已导出为 ${kind.toUpperCase()}`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '导出失败')
    }
  }, [activePath, documentTitle, markdown, showNotice])

  const handleDropImage = useCallback(async (sourcePath: string) => {
    if (!workspaceRoot) {
      showNotice('请先打开一个工作区，再插入图片')
      return
    }

    try {
      const relativePath = await window.desktop.copyAsset(sourcePath, workspaceRoot)
      const source = `file:///${encodeURI(`${workspaceRoot.replace(/[\\/]$/, '')}/${relativePath}`.replace(/\\/g, '/'))}`
      editorRef.current?.insertImage(source, sourcePath.split(/[\\/]/).pop() ?? '图片')
      showNotice('图片已复制到工作区 assets 目录')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '插入图片失败')
    }
  }, [showNotice, workspaceRoot])

  const handleOutlineSelect = useCallback((item: OutlineItem) => {
    const headingIndex = outline.findIndex((candidate) => candidate.id === item.id)
    if (headingIndex >= 0) editorRef.current?.selectHeading(headingIndex, item.line)
  }, [outline])

  const handleMenuCommand = useCallback((command: MenuCommand) => {
    switch (command) {
      case 'file.new': newDocument(); break
      case 'file.openFolder': void openWorkspace(); break
      case 'file.open': void window.desktop.openMarkdownDialog(); break
      case 'file.save': void saveDocument(); break
      case 'file.saveAs': void saveAs(); break
      case 'file.exportHtml': void exportDocument('html'); break
      case 'file.exportPdf': void exportDocument('pdf'); break
      case 'file.print': void window.desktop.print(); break
      case 'edit.undo': document.execCommand('undo'); break
      case 'edit.redo': document.execCommand('redo'); break
      case 'edit.cut': document.execCommand('cut'); break
      case 'edit.copy': document.execCommand('copy'); break
      case 'edit.paste': document.execCommand('paste'); break
      case 'edit.selectAll': document.execCommand('selectAll'); break
      case 'format.bold': editorRef.current?.toggleBold(); break
      case 'format.italic': editorRef.current?.toggleItalic(); break
      case 'format.strike': editorRef.current?.toggleStrike(); break
      case 'format.inlineCode': editorRef.current?.toggleInlineCode(); break
      case 'paragraph.heading1': editorRef.current?.setHeading(1); break
      case 'paragraph.heading2': editorRef.current?.setHeading(2); break
      case 'paragraph.heading3': editorRef.current?.setHeading(3); break
      case 'paragraph.table': editorRef.current?.insertTable(); break
      case 'paragraph.bulletList': editorRef.current?.toggleBulletList(); break
      case 'paragraph.orderedList': editorRef.current?.toggleOrderedList(); break
      case 'paragraph.taskList': editorRef.current?.toggleTaskList(); break
      case 'paragraph.blockquote': editorRef.current?.toggleBlockquote(); break
      case 'paragraph.codeBlock': editorRef.current?.toggleCodeBlock(); break
      case 'paragraph.horizontalRule': editorRef.current?.insertHorizontalRule(); break
      case 'view.toggleSidebar': toggleSidebar(); break
      case 'view.toggleOutline': setSidebarTab('outline'); setSidebarOpen(true); break
      case 'view.toggleSource': toggleMode(); break
      case 'view.toggleFocus': setFocusMode((current) => !current); break
      case 'view.zoomIn': setZoom((current) => Math.min(1.25, current + 0.05)); break
      case 'view.zoomOut': setZoom((current) => Math.max(0.8, current - 0.05)); break
      case 'view.resetZoom': setZoom(1); break
      case 'theme.toggle': setTheme((current) => current === 'light' ? 'dark' : 'light'); break
      case 'help.shortcuts': setShortcutsOpen(true); break
    }
  }, [exportDocument, newDocument, openWorkspace, saveAs, saveDocument, toggleMode, toggleSidebar])

  useEffect(() => {
    localStorage.setItem('markdown-desk-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('markdown-desk-sidebar', sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  useEffect(() => {
    localStorage.setItem('markdown-desk-ai-panel', aiOpen ? 'open' : 'closed')
  }, [aiOpen])

  useEffect(() => {
    if (!preview) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [preview])

  useEffect(() => {
    localStorage.setItem('markdown-desk-recent', JSON.stringify(recentPaths))
  }, [recentPaths])

  useEffect(() => window.desktop.onMenuCommand(handleMenuCommand), [handleMenuCommand])

  useEffect(() => window.desktop.onWorkspaceSelected((selection: WorkspaceSelection) => {
    setWorkspaceRoot(selection.root)
    setFileTree(selection.tree)
  }), [])

  useEffect(() => window.desktop.onDocumentOpened((document: OpenedDocument) => {
    autoOpenedRef.current = true
    void openDocument(document.path, document.content)
  }), [openDocument])

  useEffect(() => window.desktop.onFileChanged((filePath) => {
    if (filePath !== activePath) return
    void window.desktop.readMarkdown(filePath).then((nextContent) => {
      if (nextContent === markdown) return
      if (dirty && !window.confirm('这个文档已被其他程序修改，重新加载会丢失当前未保存内容。继续吗？')) return
      void openDocument(filePath, nextContent)
    }).catch(() => undefined)
  }), [activePath, dirty, markdown, openDocument])

  useEffect(() => {
    if (!activePath || !dirty) return
    const timer = window.setTimeout(() => {
      void window.desktop.writeRecovery({ path: activePath, markdown, createdAt: Date.now() })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [activePath, dirty, markdown])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      const isTextField = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement

      if (event.altKey && event.shiftKey && event.code === 'Digit5' && mode === 'wysiwyg' && !isTextField) {
        event.preventDefault()
        editorRef.current?.toggleStrike()
        return
      }

      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) return
      if (key === 's') { event.preventDefault(); void (event.shiftKey ? saveAs() : saveDocument()); return }
      if (key === 'n' && !event.shiftKey) { event.preventDefault(); newDocument(); return }
      if (key === 'o' && event.shiftKey) { event.preventDefault(); void openWorkspace(); return }
      if (key === 'f' && !event.shiftKey) { event.preventDefault(); setSearchOpen(true); return }
      if (key === '/' && !event.shiftKey) { event.preventDefault(); toggleMode(); return }
      if (key === 'l' && event.shiftKey) { event.preventDefault(); toggleSidebar(); return }
      if (key === 'f' && event.shiftKey) { event.preventDefault(); setFocusMode((current) => !current); return }
      if (key === 'p' && !event.shiftKey) { event.preventDefault(); void window.desktop.print(); return }
      if (key === '=' || key === '+') { event.preventDefault(); setZoom((current) => Math.min(1.25, current + 0.05)); return }
      if (key === '-') { event.preventDefault(); setZoom((current) => Math.max(0.8, current - 0.05)); return }
      if (key === '0' && !event.shiftKey) {
        event.preventDefault()
        if (mode === 'wysiwyg' && !isTextField) editorRef.current?.setParagraph()
        else setZoom(1)
        return
      }

      if (mode !== 'wysiwyg' || isTextField) return
      if (/^[1-6]$/.test(key) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        editorRef.current?.setHeading(Number(key) as 1 | 2 | 3 | 4 | 5 | 6)
        return
      }
      if (key === 'b' && !event.shiftKey) { event.preventDefault(); editorRef.current?.toggleBold(); return }
      if (key === 'i' && !event.shiftKey) { event.preventDefault(); editorRef.current?.toggleItalic(); return }
      if (key === 'k' && !event.shiftKey) { event.preventDefault(); insertLink(); return }
      if (key === 'x' && event.shiftKey) { event.preventDefault(); editorRef.current?.toggleStrike(); return }
      if (key === 'k' && event.shiftKey) { event.preventDefault(); editorRef.current?.toggleCodeBlock(); return }
      if (key === 'q' && event.shiftKey) { event.preventDefault(); editorRef.current?.toggleBlockquote(); return }
      if (key === '7' && event.shiftKey) { event.preventDefault(); editorRef.current?.toggleOrderedList(); return }
      if (key === '8' && event.shiftKey) { event.preventDefault(); editorRef.current?.toggleBulletList(); return }
      if (key === '9' && event.shiftKey) { event.preventDefault(); editorRef.current?.toggleTaskList(); return }
      if (event.shiftKey && event.code === 'Backquote') { event.preventDefault(); editorRef.current?.toggleInlineCode() }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [insertLink, mode, newDocument, openWorkspace, saveAs, saveDocument, toggleMode, toggleSidebar])

  return (
    <div className={`app-shell theme-${theme}${focusMode ? ' is-focus-mode' : ''}${sidebarOpen ? '' : ' is-sidebar-closed'}`} style={{ '--editor-zoom': zoom } as CSSProperties}>
      <div className="workspace-layout">
        {sidebarOpen && (
          <aside className="sidebar" aria-label="文档导航">
            <div className="sidebar-tabs" role="tablist" aria-label="文档导航模式">
              <button type="button" role="tab" aria-selected={sidebarTab === 'files'} className={sidebarTab === 'files' ? 'is-active' : ''} onClick={() => setSidebarTab('files')}>文件</button>
              <button type="button" role="tab" aria-selected={sidebarTab === 'outline'} className={sidebarTab === 'outline' ? 'is-active' : ''} onClick={() => setSidebarTab('outline')}>大纲</button>
            </div>
            <div className="sidebar-scroll">
              {sidebarTab === 'files' ? (
                <div className="files-sidebar">
                  {fileTree.length > 0 ? (
                    <FileTree
                      nodes={fileTree}
                      activePath={activePath}
                      expandedPaths={expandedPaths}
                      onToggle={(path) => setExpandedPaths((current) => {
                        const next = new Set(current)
                        if (next.has(path)) next.delete(path)
                        else next.add(path)
                        return next
                      })}
                      onSelect={(path) => void openDocument(path)}
                    />
                  ) : workspaceRoot ? (
                    <div className="sidebar-empty">
                      <FolderOpen size={20} strokeWidth={1.6} aria-hidden="true" />
                      <p>当前工作区没有 Markdown 文件。</p>
                      <button type="button" className="text-button" onClick={() => void openWorkspace()}>重新选择工作区</button>
                    </div>
                  ) : null}

                  {recentPaths.length > 0 ? (
                    <section className="recent-files" aria-labelledby="recent-files-title">
                      <div className="recent-files-heading">
                        <span id="recent-files-title" className="eyebrow">最近打开</span>
                      </div>
                      <div className="recent-files-list">
                        {recentPaths.map((filePath) => (
                          <button
                            type="button"
                            className={`recent-file${filePath === activePath ? ' is-active' : ''}`}
                            key={filePath}
                            title={filePath}
                            onClick={() => void openRecent(filePath)}
                          >
                            <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
                            <span className="recent-file-label">{filePath.split(/[\\/]/).pop() ?? filePath}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {!workspaceRoot && recentPaths.length === 0 ? <div className="sidebar-blank" aria-label="尚未选择工作区" /> : null}
                </div>
              ) : (
                <Outline items={outline} activeLine={cursor.line} onSelect={handleOutlineSelect} />
              )}
            </div>
          </aside>
        )}

        <section className="editor-pane" aria-label="Markdown 编辑器">
          <div className="editor-scroll">
            <article className="editor-frame">
              <MarkdownEditor
                ref={editorRef}
                markdown={markdown}
                mode={mode}
                workspaceRoot={workspaceRoot}
                onMarkdownChange={setMarkdown}
                onSourceChange={setMarkdown}
                onCursorChange={setCursor}
                onDropImage={handleDropImage}
                onOpenPreview={handleOpenPreview}
              />
            </article>
          </div>

          <footer className="status-bar">
            <div className="status-controls">
              <IconButton icon={sidebarOpen ? ChevronLeft : PanelLeft} label={sidebarOpen ? '隐藏侧栏' : '显示侧栏'} onClick={toggleSidebar} active={sidebarOpen} />
              <IconButton icon={Code2} label={mode === 'source' ? '切换到所见即所得' : '切换到源码'} onClick={toggleMode} active={mode === 'source'} />
              <IconButton icon={Sparkles} label={aiOpen ? '关闭 AI 面板' : '打开 AI 面板'} onClick={() => setAiOpen((current) => !current)} active={aiOpen} />
            </div>
            <span className="status-spacer" />
            <div className="status-info">
              <span>{stats.characters.toLocaleString()} 字符</span>
              <span>{stats.words.toLocaleString()} 词</span>
              <span>第 {cursor.line} 行，第 {cursor.column} 列</span>
              <span>{mode === 'source' ? 'Markdown 源码' : '所见即所得'}</span>
              <span>UTF-8</span>
            </div>
          </footer>
        </section>

        {aiOpen && (
          <AiPanel
            editorRef={editorRef}
            markdown={markdown}
            documentKey={activePath || 'untitled'}
            documentTitle={documentTitle}
            onClose={() => setAiOpen(false)}
            onSelectLine={(line) => editorRef.current?.selectLine(line)}
          />
        )}
      </div>

      {searchOpen && (
        <div className="search-panel" role="dialog" aria-label="搜索文档">
          <Search size={17} strokeWidth={1.8} aria-hidden="true" />
          <input
            autoFocus
            value={searchQuery}
            aria-label="搜索文本"
            placeholder="搜索文档…"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setSearchOpen(false)
                return
              }
              if (event.key === 'Enter' && searchQuery) {
                event.preventDefault()
                window.find(searchQuery, false, false, true)
              }
            }}
          />
          <span className="search-count">{searchQuery ? `${markdown.split(searchQuery).length - 1} 处` : ''}</span>
          <button type="button" className="search-close" onClick={() => setSearchOpen(false)}>关闭</button>
        </div>
      )}

      {shortcutsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShortcutsOpen(false)}>
          <section className="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">QUICK REFERENCE</span>
                <h2 id="shortcuts-title">快捷键</h2>
              </div>
              <button type="button" className="dialog-close" aria-label="关闭快捷键" onClick={() => setShortcutsOpen(false)}>×</button>
            </div>
            <div className="shortcut-list">
              {[
                ['保存', 'Ctrl + S'],
                ['另存为', 'Ctrl + Shift + S'],
                ['搜索', 'Ctrl + F'],
                ['一级至六级标题', 'Ctrl + 1 … 6'],
                ['正文段落', 'Ctrl + 0'],
                ['加粗', 'Ctrl + B'],
                ['斜体', 'Ctrl + I'],
                ['删除线', 'Ctrl + Shift + X / Alt + Shift + 5'],
                ['行内代码', 'Ctrl + Shift + `'],
                ['插入链接', 'Ctrl + K'],
                ['有序列表', 'Ctrl + Shift + 7'],
                ['无序列表', 'Ctrl + Shift + 8'],
                ['任务列表', 'Ctrl + Shift + 9'],
                ['引用', 'Ctrl + Shift + Q'],
                ['代码块', 'Ctrl + Shift + K'],
                ['切换源码模式', 'Ctrl + /'],
                ['显示/隐藏侧栏', 'Ctrl + Shift + L'],
                ['专注模式', 'Ctrl + Shift + F'],
                ['打印', 'Ctrl + P'],
                ['放大 / 缩小', 'Ctrl + + / −'],
              ].map(([label, keys]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreview(null)}>
          <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={preview.kind === 'svg' ? preview.title : preview.alt} onMouseDown={(event) => event.stopPropagation()}>
            <div className="preview-dialog-header">
              <div className="preview-header-left">
                <span className="preview-title">{preview.kind === 'svg' ? preview.title : preview.alt}</span>
                <span className="preview-type-badge">{preview.kind === 'svg' ? 'Mermaid 矢量图' : '图片'}</span>
              </div>
              <div className="preview-actions">
                <span className="preview-zoom-label" aria-live="polite">{Math.round(previewZoom * 100)}% · Ctrl + 滚轮缩放 / 拖拽平移</span>
                <button type="button" className="preview-zoom-button" aria-label="缩小预览" title="缩小预览 (Ctrl + -)" onClick={() => changePreviewZoom(-0.1)}>−</button>
                <button type="button" className="preview-zoom-button preview-zoom-reset" aria-label="重置预览缩放" title="重置 100%" onClick={() => setPreviewZoom(1)}>100%</button>
                <button type="button" className="preview-zoom-button" aria-label="放大预览" title="放大预览 (Ctrl + +)" onClick={() => changePreviewZoom(0.1)}>＋</button>
                <button type="button" className="preview-copy-button" aria-label="复制预览内容" onClick={() => void copyPreviewContent()}>
                  {preview.kind === 'svg' ? '复制 SVG' : '复制链接'}
                </button>
                <button type="button" className="preview-close" autoFocus aria-label="关闭" onClick={() => setPreview(null)}>关闭</button>
              </div>
            </div>
            <div
              ref={previewStageRef}
              className={`preview-stage${preview.kind === 'svg' ? ' is-diagram' : ''}${isPanning ? ' is-panning' : ''}`}
              data-preview-zoom={previewZoom}
              onWheel={zoomPreviewAtPoint}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onMouseLeave={handleStageMouseUp}
            >
              <div className="preview-zoom-surface" style={{ '--preview-zoom': previewZoom } as CSSProperties}>
                <div className="preview-zoom-content">
                  {preview.kind === 'image' ? (
                    <img src={preview.src} alt={preview.alt} draggable={false} />
                  ) : (
                    <div className="preview-svg" dangerouslySetInnerHTML={{ __html: preview.markup }} />
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}
    </div>
  )
}
