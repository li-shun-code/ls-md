import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'
import { AlertTriangle, ChevronLeft, Code2, FolderOpen, History, PanelLeft, Search, Settings, Sparkles, X } from 'lucide-react'
import type { AiOperation, FileNode, MenuCommand, MarkdownMode, OpenedDocument, RecoverySnapshot, UpdateState, WorkspaceSelection } from '@shared/types'
import { FileTree } from '@renderer/components/FileTree'
import { IconButton } from '@renderer/components/IconButton'
import { MarkdownEditor, type EditorCommands, type EditorPreview } from '@renderer/components/MarkdownEditor'
import { AiPanel } from '@renderer/components/AiPanel'
import { Outline } from '@renderer/components/Outline'
import { SettingsModal, type SettingsTab } from './components/SettingsModal'
import { CodeRunnerDialog } from '@renderer/components/CodeRunnerDialog'
import { VersionHistoryModal } from '@renderer/components/VersionHistoryModal'
import {
  buildExportHtml,
  countDocument,
  extractOutline,
  markdownFromEditor,
} from '@renderer/utils/markdown'
import type { OutlineItem } from '@renderer/utils/markdown'
import { downloadDiagram, downloadImage, type ExportFormat } from '@renderer/utils/diagram-export'
import { WELCOME_DOCUMENT_MARKDOWN } from '@renderer/utils/welcome-document'
import './styles.css'

type SidebarTab = 'files' | 'outline'
type Theme = 'light' | 'dark'
type DocumentTab = {
  id: string
  path: string
  markdown: string
  savedMarkdown: string
  workspaceRoot: string
  mode: MarkdownMode
}

function normalizeDocumentPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function App() {
  const editorRef = useRef<EditorCommands>(null)
  const [initialTabId] = useState(() => crypto.randomUUID())
  const [documentTabs, setDocumentTabs] = useState<DocumentTab[]>(() => [{
    id: initialTabId,
    path: '',
    markdown: WELCOME_DOCUMENT_MARKDOWN,
    savedMarkdown: WELCOME_DOCUMENT_MARKDOWN,
    workspaceRoot: '',
    mode: 'wysiwyg',
  }])
  const [activeTabId, setActiveTabId] = useState(initialTabId)
  const documentWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const enqueueDocumentWrite = useCallback(<T,>(write: () => Promise<T>) => {
    const next = documentWriteQueueRef.current.then(write, write)
    documentWriteQueueRef.current = next.then(() => undefined, () => undefined)
    return next
  }, [])
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [activePath, setActivePath] = useState('')
  const [markdown, setMarkdown] = useState(WELCOME_DOCUMENT_MARKDOWN)
  const [savedMarkdown, setSavedMarkdown] = useState(WELCOME_DOCUMENT_MARKDOWN)
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
  const [aiAction, setAiAction] = useState<{ operation: AiOperation; prompt?: string; timestamp: number } | null>(null)
  const [recoveryBanner, setRecoveryBanner] = useState<{ path: string; snapshot: RecoverySnapshot } | null>(null)
  const [externalChangeBanner, setExternalChangeBanner] = useState<{ path: string; newContent: string } | null>(null)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('runners')
  const [runnerDialog, setRunnerDialog] = useState<{ language: string; code: string; workingDirectory?: string } | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)

  const deferredMarkdown = useDeferredValue(markdown)
  const outline = useMemo(() => extractOutline(deferredMarkdown), [deferredMarkdown])
  const stats = useMemo(() => countDocument(deferredMarkdown), [deferredMarkdown])
  const dirty = markdown !== savedMarkdown
  const documentTitle = activePath ? activePath.split(/[\\/]/).pop() ?? '未命名文档' : '未命名文档'

  const autoOpenedRef = useRef(false)
  const activePathRef = useRef(activePath)
  activePathRef.current = activePath
  const markdownRef = useRef(markdown)
  markdownRef.current = markdown

  const rememberRecent = useCallback((filePath: string) => {
    try { localStorage.setItem('markdown-desk-last-file', filePath) } catch { /* ignore */ }
  }, [])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 2800)
  }, [])

  useEffect(() => {
    setDocumentTabs((current) => {
      const index = current.findIndex((tab) => tab.id === activeTabId)
      if (index < 0) return current
      const currentTab = current[index]
      if (
        currentTab.path === activePath &&
        currentTab.markdown === markdown &&
        currentTab.savedMarkdown === savedMarkdown &&
        currentTab.workspaceRoot === workspaceRoot &&
        currentTab.mode === mode
      ) return current
      const next = [...current]
      next[index] = { ...currentTab, path: activePath, markdown, savedMarkdown, workspaceRoot, mode }
      return next
    })
  }, [activePath, activeTabId, markdown, mode, savedMarkdown, workspaceRoot])

  const handleOpenSettings = useCallback((tab: SettingsTab = 'runners') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  // 在线升级：订阅主进程状态；发现新版本时提示用户（用户确认后才下载/安装）
  useEffect(() => {
    void window.desktop.getUpdateState().then(setUpdateState).catch(() => undefined)
    return window.desktop.onUpdateState((state) => {
      setUpdateState(state)
      if (state.status === 'available' || state.status === 'downloaded') {
        setUpdateBannerDismissed(false)
      }
    })
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((current) => !current)
  }, [])

  const handleRunCode = useCallback((lang: string, code: string, workingDirectory?: string) => {
    setAiOpen(false)
    setRunnerDialog({ language: lang, code, workingDirectory })
  }, [])

  const insertLink = useCallback(() => {
    if (mode !== 'wysiwyg') return
    const url = window.prompt('输入链接地址', 'https://')
    if (url) editorRef.current?.setLink(url)
  }, [mode])

  const [isPanning, setIsPanning] = useState(false)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)

  const handleOpenPreview = useCallback((nextPreview: EditorPreview) => {
    setDownloadMenuOpen(false)
    setPreviewZoom(1)
    setPreview(nextPreview)
  }, [])

  const changePreviewZoom = useCallback((delta: number) => {
    setPreviewZoom((current) => Math.round(Math.min(4, Math.max(0.3, current + delta)) * 100) / 100)
  }, [])

  const handleDownload = useCallback(async (format: ExportFormat) => {
    if (!preview) return
    try {
      setDownloadMenuOpen(false)
      if (preview.kind === 'svg') {
        await downloadDiagram(preview.markup, format, preview.title)
      } else {
        await downloadImage(preview.src, format === 'svg' ? 'png' : format, preview.alt)
      }
      showNotice(`已下载为 ${format.toUpperCase()} 格式`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '下载失败')
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
    const stage = previewStageRef.current
    const targetLeft = panStartRef.current.scrollLeft - deltaX
    const targetTop = panStartRef.current.scrollTop - deltaY
    window.requestAnimationFrame(() => {
      if (stage) {
        stage.scrollLeft = targetLeft
        stage.scrollTop = targetTop
      }
    })
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

  const persistActiveTab = useCallback(async () => {
    if (!activePath || !dirty || externalChangeBanner) return
    const currentContent = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
    await enqueueDocumentWrite(() => window.desktop.writeMarkdown(activePath, currentContent, 'auto'))
    setDocumentTabs((current) => current.map((tab) => tab.path === activePath
      ? { ...tab, markdown: currentContent, savedMarkdown: currentContent }
      : tab))
    if (activePathRef.current === activePath) {
      setSavedMarkdown(currentContent)
      setAutoSaveStatus('saved')
    }
    if (markdownRef.current === currentContent) await window.desktop.clearRecovery(activePath)
  }, [activePath, dirty, enqueueDocumentWrite, externalChangeBanner, markdown, mode, workspaceRoot])

  const activateDocumentTab = useCallback(async (tabId: string) => {
    const tab = documentTabs.find((item) => item.id === tabId)
    if (!tab || tabId === activeTabId) return
    try {
      await persistActiveTab()
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '自动保存失败')
    }
    setActiveTabId(tab.id)
    setActivePath(tab.path)
    setMarkdown(tab.markdown)
    setSavedMarkdown(tab.savedMarkdown)
    setWorkspaceRoot(tab.workspaceRoot)
    setMode(tab.mode)
    setAutoSaveStatus(tab.path ? (tab.markdown === tab.savedMarkdown ? 'saved' : 'pending') : 'idle')
    setRunnerDialog(null)
    setRecoveryBanner(null)
    setExternalChangeBanner(null)
    setCursor({ line: 1, column: 1 })
    if (tab.path) {
      void window.desktop.openMarkdownPath(tab.path).catch((error) => {
        showNotice(error instanceof Error ? error.message : '无法切换到此文档')
      })
    }
  }, [activeTabId, documentTabs, persistActiveTab, showNotice])

  const openDocument = useCallback(async (filePath: string, contentOverride?: string) => {
    try {
      const resolvedPath = filePath
      const normalizedPath = normalizeDocumentPath(resolvedPath)
      const existingTab = documentTabs.find((tab) => tab.path && normalizeDocumentPath(tab.path) === normalizedPath)
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          await activateDocumentTab(existingTab.id)
        } else if (contentOverride !== undefined && existingTab.markdown === existingTab.savedMarkdown) {
          setMarkdown(contentOverride)
          setSavedMarkdown(contentOverride)
          setAutoSaveStatus('saved')
        } else if (contentOverride !== undefined && contentOverride !== existingTab.savedMarkdown) {
          setExternalChangeBanner({ path: resolvedPath, newContent: contentOverride })
        }
        return
      }

      await persistActiveTab()
      setRunnerDialog(null)
      void window.desktop.logToFile?.('info', '打开文档标签', { filePath: resolvedPath }).catch(() => undefined)
      const content = contentOverride ?? (await window.desktop.readMarkdown(resolvedPath))
      const snapshot = await window.desktop.readRecovery(resolvedPath)

      // 规范化比对，避免因纯空格或换行符格式化引发误恢复
      const normalizeText = (text: string) => text.replace(/\r\n/g, '\n').trim()
      if (snapshot && normalizeText(snapshot.markdown) !== normalizeText(content)) {
        setRecoveryBanner({ path: resolvedPath, snapshot })
      } else {
        setRecoveryBanner(null)
        if (snapshot) {
          void window.desktop.clearRecovery(resolvedPath)
        }
      }
      setExternalChangeBanner(null)

      const normalizedRoot = workspaceRoot ? workspaceRoot.replace(/\\/g, '/').toLowerCase() : ''
      const nextRoot = !workspaceRoot || !normalizedPath.startsWith(normalizedRoot)
        ? resolvedPath.replace(/[\\/][^\\/]+$/, '')
        : workspaceRoot
      const nextTab: DocumentTab = {
        id: crypto.randomUUID(),
        path: resolvedPath,
        markdown: content,
        savedMarkdown: content,
        workspaceRoot: nextRoot,
        mode: 'wysiwyg',
      }
      const replaceWelcome = documentTabs.length === 1 &&
        !documentTabs[0].path &&
        documentTabs[0].markdown === WELCOME_DOCUMENT_MARKDOWN
      setDocumentTabs((current) => replaceWelcome ? [nextTab] : [...current, nextTab])
      setActiveTabId(nextTab.id)
      setActivePath(resolvedPath)
      setWorkspaceRoot(nextRoot)
      if (nextRoot !== workspaceRoot) void refreshTree(nextRoot)
      setMarkdown(content)
      setSavedMarkdown(content)
      setMode('wysiwyg')
      setCursor({ line: 1, column: 1 })
      setAutoSaveStatus('saved')
      rememberRecent(resolvedPath)
      void window.desktop.logToFile?.('info', '切换文档完成', {
        filePath: resolvedPath,
        contentChars: content.length,
      }).catch(() => undefined)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开文档失败')
      void window.desktop.logToFile?.('error', '切换文档失败', {
        filePath,
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined)
    }
  }, [activateDocumentTab, activeTabId, documentTabs, persistActiveTab, refreshTree, rememberRecent, showNotice, workspaceRoot])

  const handleApplyRecovery = useCallback(async () => {
    if (!recoveryBanner) return
    const restoredText = recoveryBanner.snapshot.markdown
    setMarkdown(restoredText)
    await window.desktop.clearRecovery(recoveryBanner.path)
    setRecoveryBanner(null)
    showNotice('已恢复未保存版本内容')
  }, [recoveryBanner, showNotice])

  const handleDiscardRecovery = useCallback(async () => {
    if (!recoveryBanner) return
    await window.desktop.clearRecovery(recoveryBanner.path)
    setRecoveryBanner(null)
    showNotice('已放弃未保存恢复内容')
  }, [recoveryBanner, showNotice])

  const handleAcceptExternal = useCallback(() => {
    if (!externalChangeBanner) return
    setMarkdown(externalChangeBanner.newContent)
    setSavedMarkdown(externalChangeBanner.newContent)
    setExternalChangeBanner(null)
    showNotice('已载入外部修改版本')
  }, [externalChangeBanner, showNotice])

  const handleKeepLocal = useCallback(() => {
    setExternalChangeBanner(null)
    showNotice('已保留当前编辑版本')
  }, [showNotice])

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
  }, [openDocument])

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
    void persistActiveTab().catch((error) => showNotice(error instanceof Error ? error.message : '自动保存失败'))
    const nextTab: DocumentTab = {
      id: crypto.randomUUID(),
      path: '',
      markdown: '',
      savedMarkdown: '',
      workspaceRoot,
      mode: 'wysiwyg',
    }
    setDocumentTabs((current) => [...current, nextTab])
    setActiveTabId(nextTab.id)
    setActivePath('')
    setMarkdown('')
    setSavedMarkdown('')
    setWorkspaceRoot(nextTab.workspaceRoot)
    setAutoSaveStatus('idle')
    setRecoveryBanner(null)
    setExternalChangeBanner(null)
    setRunnerDialog(null)
    setMode('wysiwyg')
    setCursor({ line: 1, column: 1 })
    window.setTimeout(() => editorRef.current?.focus(), 0)
  }, [persistActiveTab, showNotice, workspaceRoot])

  const closeDocumentTab = useCallback(async (tabId: string) => {
    const tab = documentTabs.find((item) => item.id === tabId)
    if (!tab) return
    const content = tabId === activeTabId ? markdown : tab.markdown
    const savedContent = tabId === activeTabId ? savedMarkdown : tab.savedMarkdown
    if (content !== savedContent) {
      if (tab.path) {
        try {
          await enqueueDocumentWrite(() => window.desktop.writeMarkdown(tab.path, content, 'auto'))
          await window.desktop.clearRecovery(tab.path)
        } catch (error) {
          showNotice(error instanceof Error ? error.message : '自动保存失败，无法关闭标签')
          return
        }
      } else if (!window.confirm('此未命名文档尚未保存，确定关闭并丢弃吗？')) {
        return
      }
    }

    const remaining = documentTabs.filter((item) => item.id !== tabId)
    if (remaining.length === 0) {
      const welcomeTab: DocumentTab = {
        id: crypto.randomUUID(),
        path: '',
        markdown: WELCOME_DOCUMENT_MARKDOWN,
        savedMarkdown: WELCOME_DOCUMENT_MARKDOWN,
        workspaceRoot: '',
        mode: 'wysiwyg',
      }
      remaining.push(welcomeTab)
    }
    setDocumentTabs(remaining)
    if (tabId === activeTabId) {
      const nextTab = remaining[Math.max(0, documentTabs.findIndex((item) => item.id === tabId) - 1)]
      setActiveTabId(nextTab.id)
      setActivePath(nextTab.path)
      setMarkdown(nextTab.markdown)
      setSavedMarkdown(nextTab.savedMarkdown)
      setWorkspaceRoot(nextTab.workspaceRoot)
      setMode(nextTab.mode)
      setAutoSaveStatus(nextTab.path ? (nextTab.markdown === nextTab.savedMarkdown ? 'saved' : 'pending') : 'idle')
      setRecoveryBanner(null)
      setExternalChangeBanner(null)
      setCursor({ line: 1, column: 1 })
      if (nextTab.path) void window.desktop.openMarkdownPath(nextTab.path).catch((error) => showNotice(error instanceof Error ? error.message : '无法打开文档标签'))
    }
  }, [activeTabId, documentTabs, enqueueDocumentWrite, markdown, savedMarkdown, showNotice])

  const saveDocument = useCallback(async () => {
    try {
      const content = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
      if (!activePath) {
        const saved = await enqueueDocumentWrite(() => window.desktop.saveMarkdownAs('未命名.md', content))
        if (!saved) return
        setRecoveryBanner(null)
        setExternalChangeBanner(null)
        setActivePath(saved.path)
        setWorkspaceRoot(saved.path.replace(/[\\/][^\\/]+$/, ''))
        setMarkdown(saved.content)
        setSavedMarkdown(saved.content)
        setAutoSaveStatus('saved')
        await window.desktop.clearRecovery(saved.path)
        showNotice('文档已保存')
        return
      }

      await enqueueDocumentWrite(() => window.desktop.writeMarkdown(activePath, content, 'manual'))
      setRecoveryBanner(null)
      setExternalChangeBanner(null)
      setMarkdown(content)
      setSavedMarkdown(content)
      setAutoSaveStatus('saved')
      await window.desktop.clearRecovery(activePath)
      if (workspaceRoot) await refreshTree(workspaceRoot)
      showNotice('文档已保存')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '保存失败')
    }
  }, [activePath, enqueueDocumentWrite, markdown, mode, refreshTree, showNotice, workspaceRoot])

  const saveAs = useCallback(async () => {
    try {
      const content = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
      const saved = await enqueueDocumentWrite(() => window.desktop.saveMarkdownAs(activePath || '未命名.md', content))
      if (!saved) return
      setRecoveryBanner(null)
      setExternalChangeBanner(null)
      setActivePath(saved.path)
      setWorkspaceRoot(saved.path.replace(/[\\/][^\\/]+$/, ''))
      setMarkdown(saved.content)
      setSavedMarkdown(saved.content)
      setAutoSaveStatus('saved')
      await window.desktop.clearRecovery(saved.path)
      showNotice('文档已另存为')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '另存为失败')
    }
  }, [activePath, enqueueDocumentWrite, markdown, mode, showNotice, workspaceRoot])

  const handleRestoreVersion = useCallback(async (versionMarkdown: string) => {
    if (!activePath) return
    try {
      const currentContent = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
      await enqueueDocumentWrite(() => window.desktop.writeMarkdown(activePath, currentContent, 'restore'))
      await enqueueDocumentWrite(() => window.desktop.writeMarkdown(activePath, versionMarkdown, 'restore'))
      setMarkdown(versionMarkdown)
      setSavedMarkdown(versionMarkdown)
      setAutoSaveStatus('saved')
      setRecoveryBanner(null)
      setExternalChangeBanner(null)
      await window.desktop.clearRecovery(activePath)
      if (workspaceRoot) await refreshTree(workspaceRoot)
      showNotice('已恢复所选版本')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '恢复版本失败')
      throw error
    }
  }, [activePath, enqueueDocumentWrite, markdown, mode, refreshTree, showNotice, workspaceRoot])

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
      const body = await editorRef.current?.getHtmlForExport() ?? ''
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

  const handleNavigateLink = useCallback(async (href: string) => {
    if (!href) return

    // 1. 外部超链接
    if (/^(?:https?|mailto):/i.test(href)) {
      try {
        await window.desktop.openExternal(href)
      } catch {
        window.open(href, '_blank')
      }
      return
    }

    // 2. 内部锚点跳转（当前文档内标题）
    if (href.startsWith('#')) {
      const anchor = decodeURIComponent(href.slice(1)).trim().toLowerCase()
      if (!anchor) return
      const targetItem = outline.find((item) =>
        item.text.toLowerCase() === anchor ||
        item.id.toLowerCase() === anchor ||
        item.id.toLowerCase().replace(/^heading-\d+-/, '') === anchor
      )
      if (targetItem) {
        handleOutlineSelect(targetItem)
        showNotice(`已跳转到「${targetItem.text}」`)
        return
      }
      const editorDom = document.querySelector('.tiptap-editor')
      const headings = editorDom?.querySelectorAll('h1, h2, h3, h4, h5, h6')
      if (headings) {
        for (const heading of headings) {
          if (heading.textContent?.trim().toLowerCase() === anchor || heading.id.toLowerCase() === anchor) {
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
            showNotice(`已跳转到「${heading.textContent}」`)
            return
          }
        }
      }
      showNotice(`未找到锚点：${anchor}`)
      return
    }

    // 3. 关联 Markdown 文档跳转
    const [pathPart, anchorPart] = href.split('#')
    const targetRelativePath = decodeURIComponent(pathPart).trim()
    if (!targetRelativePath) return

    const currentDir = activePath ? activePath.replace(/[\\/][^\\/]+$/, '') : (workspaceRoot || '')
    const fullPath = await window.desktop.resolvePath(currentDir, targetRelativePath)
    if (!fullPath) {
      showNotice(`无法定位关联文档：${targetRelativePath}`)
      return
    }

    try {
      await openDocument(fullPath)
      if (anchorPart) {
        const anchor = decodeURIComponent(anchorPart).trim().toLowerCase()
        window.setTimeout(() => {
          const editorDom = document.querySelector('.tiptap-editor')
          const headings = editorDom?.querySelectorAll('h1, h2, h3, h4, h5, h6')
          if (headings) {
            for (const heading of headings) {
              if (heading.textContent?.trim().toLowerCase() === anchor || heading.id.toLowerCase() === anchor) {
                heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
                break
              }
            }
          }
        }, 200)
      }
      const fileName = fullPath.split(/[\\/]/).pop()
      showNotice(`已打开关联文档：${fileName}`)
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '打开关联文档失败')
    }
  }, [activePath, handleOutlineSelect, openDocument, outline, showNotice, workspaceRoot])

  const handleTriggerAiAction = useCallback((operation: AiOperation, selectedText: string) => {
    setAiAction({ operation, prompt: selectedText, timestamp: Date.now() })
    setAiOpen(true)
  }, [])

  const openWelcomeDocument = useCallback(() => {
    const existing = documentTabs.find((tab) => !tab.path && tab.markdown === WELCOME_DOCUMENT_MARKDOWN)
    if (existing) {
      void activateDocumentTab(existing.id)
      showNotice('已载入《功能全景指南》')
      return
    }
    void persistActiveTab().catch((error) => showNotice(error instanceof Error ? error.message : '自动保存失败'))
    const tab: DocumentTab = {
      id: crypto.randomUUID(),
      path: '',
      markdown: WELCOME_DOCUMENT_MARKDOWN,
      savedMarkdown: WELCOME_DOCUMENT_MARKDOWN,
      workspaceRoot,
      mode: 'wysiwyg',
    }
    setDocumentTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setActivePath('')
    setMarkdown(WELCOME_DOCUMENT_MARKDOWN)
    setSavedMarkdown(WELCOME_DOCUMENT_MARKDOWN)
    setMode('wysiwyg')
    setAutoSaveStatus('idle')
    setCursor({ line: 1, column: 1 })
    editorRef.current?.loadMarkdown(WELCOME_DOCUMENT_MARKDOWN)
    showNotice('已载入《功能全景指南》')
  }, [activateDocumentTab, documentTabs, persistActiveTab, showNotice, workspaceRoot])

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
      case 'help.welcomeDocument': openWelcomeDocument(); break
      case 'settings.open': handleOpenSettings('runners'); break
    }
  }, [exportDocument, handleOpenSettings, newDocument, openWelcomeDocument, openWorkspace, saveAs, saveDocument, toggleMode, toggleSidebar])

  useEffect(() => {
    localStorage.setItem('markdown-desk-theme', theme)
    // 同步到主进程 nativeTheme，使系统标题栏等原生 UI 跟随应用主题
    void window.desktop.setTheme(theme)
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
      const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim()
      if (normalize(nextContent) === normalize(markdown)) return

      if (!dirty) {
        setMarkdown(nextContent)
        setSavedMarkdown(nextContent)
        showNotice('文档已从外部更新')
      } else {
        setExternalChangeBanner({ path: filePath, newContent: nextContent })
      }
    }).catch(() => undefined)
  }), [activePath, dirty, markdown, showNotice])

  useEffect(() => {
    if (!activePath || !dirty) return
    const timer = window.setTimeout(() => {
      void window.desktop.writeRecovery({ path: activePath, markdown, createdAt: Date.now() })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [activePath, dirty, markdown])

  useEffect(() => {
    if (!activePath) {
      setAutoSaveStatus('idle')
      return
    }
    if (!dirty) {
      setAutoSaveStatus('saved')
      return
    }
    if (externalChangeBanner) {
      setAutoSaveStatus('idle')
      return
    }

    setAutoSaveStatus('pending')
    const savePath = activePath
    const content = mode === 'wysiwyg' ? markdown : markdownFromEditor(markdown, workspaceRoot)
    const timer = window.setTimeout(() => {
      setAutoSaveStatus('saving')
      void enqueueDocumentWrite(() => window.desktop.writeMarkdown(savePath, content, 'auto'))
        .then(async () => {
          setDocumentTabs((current) => current.map((tab) => tab.path === savePath
            ? { ...tab, savedMarkdown: content }
            : tab))
          if (activePathRef.current === savePath) {
            setSavedMarkdown(content)
            if (markdownRef.current === content) {
              setRecoveryBanner(null)
              await window.desktop.clearRecovery(savePath)
            }
            setAutoSaveStatus(markdownRef.current === content ? 'saved' : 'pending')
          } else if (markdownRef.current === content) {
            await window.desktop.clearRecovery(savePath)
          }
        })
        .catch((error) => {
          if (activePathRef.current !== savePath) return
          setAutoSaveStatus('error')
          showNotice(`自动保存失败：${error instanceof Error ? error.message : String(error)}`)
        })
    }, 1_000)
    return () => window.clearTimeout(timer)
  }, [activePath, dirty, enqueueDocumentWrite, externalChangeBanner, markdown, mode, showNotice, workspaceRoot])

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
      if (key === ',' && !event.shiftKey) { event.preventDefault(); handleOpenSettings('runners'); return }
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
  }, [handleOpenSettings, insertLink, mode, newDocument, openWorkspace, saveAs, saveDocument, toggleMode, toggleSidebar])

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
                      workspaceRoot={workspaceRoot}
                      activePath={activePath}
                      expandedPaths={expandedPaths}
                      onToggle={(path) => setExpandedPaths((current) => {
                        const next = new Set(current)
                        if (next.has(path)) next.delete(path)
                        else next.add(path)
                        return next
                      })}
                      onSelect={(path) => void openDocument(path)}
                      onRefresh={() => { if (workspaceRoot) void refreshTree(workspaceRoot) }}
                      onNotice={showNotice}
                      onOpenFile={(newPath) => void openDocument(newPath)}
                      onRenameFile={(oldPath, newPath) => {
                        const remapPath = (value: string) => value === oldPath
                          ? newPath
                          : value.startsWith(oldPath + '/') || value.startsWith(oldPath + '\\')
                            ? newPath + value.slice(oldPath.length)
                            : value
                        setDocumentTabs((current) => current.map((tab) => ({
                          ...tab,
                          path: tab.path ? remapPath(tab.path) : '',
                          workspaceRoot: tab.workspaceRoot ? remapPath(tab.workspaceRoot) : '',
                        })))
                        const renamedActivePath = activePath ? remapPath(activePath) : ''
                        if (renamedActivePath !== activePath) {
                          setActivePath(renamedActivePath)
                          if (renamedActivePath) void window.desktop.openMarkdownPath(renamedActivePath)
                        }
                        if (workspaceRoot) {
                          const nextWorkspaceRoot = remapPath(workspaceRoot)
                          setWorkspaceRoot(nextWorkspaceRoot)
                          void refreshTree(nextWorkspaceRoot)
                        }
                      }}
                      onDeleteFile={(deletedPath) => {
                        const isWithinDeletedPath = (value: string) => value === deletedPath || value.startsWith(deletedPath + '/') || value.startsWith(deletedPath + '\\')
                        setDocumentTabs((current) => current.map((tab) => tab.path && isWithinDeletedPath(tab.path)
                          ? { ...tab, path: '', savedMarkdown: '' }
                          : tab))
                        if (activePath && isWithinDeletedPath(activePath)) {
                          setActivePath('')
                          setSavedMarkdown('')
                          setAutoSaveStatus('idle')
                        }
                        if (workspaceRoot) void refreshTree(workspaceRoot)
                      }}
                    />
                  ) : workspaceRoot ? (
                    <div className="sidebar-empty">
                      <FolderOpen size={20} strokeWidth={1.6} aria-hidden="true" />
                      <p>当前工作区没有 Markdown 文件。</p>
                      <button type="button" className="text-button" onClick={() => void openWorkspace()}>重新选择工作区</button>
                    </div>
                  ) : null}

                  {!workspaceRoot ? (
                    <div className="sidebar-empty">
                      <FolderOpen size={20} strokeWidth={1.6} aria-hidden="true" />
                      <p>未打开文件夹工作区</p>
                      <button type="button" className="text-button" onClick={() => void openWorkspace()}>打开工作区</button>
                      <button type="button" className="text-button" style={{ marginTop: '6px' }} onClick={openWelcomeDocument}>查看功能全景指南</button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Outline items={outline} activeLine={cursor.line} onSelect={handleOutlineSelect} />
              )}
            </div>
          </aside>
        )}

        <section className="editor-pane" aria-label="Markdown 编辑器">
          {recoveryBanner && (
            <div className="editor-banner is-warning" role="alert">
              <span className="banner-icon"><AlertTriangle size={15} /></span>
              <span className="banner-text">
                检测到此文档有未保存的恢复版本（时间：{new Date(recoveryBanner.snapshot.createdAt).toLocaleTimeString()}）
              </span>
              <div className="banner-actions">
                <button type="button" className="banner-btn is-primary" onClick={handleApplyRecovery}>恢复未保存内容</button>
                <button type="button" className="banner-btn" onClick={handleDiscardRecovery}>丢弃恢复</button>
              </div>
            </div>
          )}
          {externalChangeBanner && (
            <div className="editor-banner is-info" role="alert">
              <span className="banner-icon"><AlertTriangle size={15} /></span>
              <span className="banner-text">
                当前文件已被外部程序更新，是否载入外部最新修改？
              </span>
              <div className="banner-actions">
                <button type="button" className="banner-btn is-primary" onClick={handleAcceptExternal}>载入外部修改</button>
                <button type="button" className="banner-btn" onClick={handleKeepLocal}>保留当前编辑</button>
              </div>
            </div>
          )}
          <div className="document-tabs" role="tablist" aria-label="打开的文档">
            {documentTabs.map((tab, index) => {
              const unnamedIndex = documentTabs.slice(0, index + 1).filter((item) => !item.path && item.markdown !== WELCOME_DOCUMENT_MARKDOWN).length
              const title = tab.path
                ? tab.path.split(/[\\/]/).pop() ?? tab.path
                : tab.markdown === WELCOME_DOCUMENT_MARKDOWN
                  ? '功能介绍'
                  : `未命名文档${unnamedIndex > 1 ? ` ${unnamedIndex}` : ''}`
              const tabDirty = tab.id === activeTabId ? dirty : tab.markdown !== tab.savedMarkdown
              return (
                <div className={`document-tab${tab.id === activeTabId ? ' is-active' : ''}`} key={tab.id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTabId}
                    className="document-tab-select"
                    title={tab.path || title}
                    onClick={() => void activateDocumentTab(tab.id)}
                  >
                    {tabDirty && <span className="document-tab-dirty" aria-label="有未保存的更改" />}
                    <span>{title}</span>
                  </button>
                  <button
                    type="button"
                    className="document-tab-close"
                    aria-label={`关闭 ${title}`}
                    title={`关闭 ${title}`}
                    onClick={() => void closeDocumentTab(tab.id)}
                  >
                    <X size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
            <button type="button" className="document-tab-new" aria-label="新建标签页" title="新建文档标签" onClick={newDocument}>
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <div className="editor-scroll">
            <article className="editor-frame">
              <MarkdownEditor
                ref={editorRef}
                markdown={markdown}
                mode={mode}
                workspaceRoot={workspaceRoot}
                scrollPositionKey={activePath || null}
                onMarkdownChange={setMarkdown}
                onSourceChange={setMarkdown}
                onCursorChange={setCursor}
                onDropImage={handleDropImage}
                onOpenPreview={handleOpenPreview}
                onNavigateLink={handleNavigateLink}
                onTriggerAiAction={handleTriggerAiAction}
                onRunCode={handleRunCode}
              />
            </article>
          </div>

          <footer className="status-bar">
            <div className="status-controls">
              <IconButton icon={sidebarOpen ? ChevronLeft : PanelLeft} label={sidebarOpen ? '隐藏侧栏' : '显示侧栏'} onClick={toggleSidebar} active={sidebarOpen} />
              <IconButton icon={Code2} label={mode === 'source' ? '切换到所见即所得' : '切换到源码'} onClick={toggleMode} active={mode === 'source'} />
              <IconButton icon={Sparkles} label={aiOpen ? '关闭 AI 面板' : '打开 AI 面板'} onClick={() => setAiOpen((current) => !current)} active={aiOpen} />
              <IconButton icon={History} label="文档版本" onClick={() => setVersionHistoryOpen(true)} disabled={!activePath} />
              <IconButton icon={Settings} label="首选项与设置 (Ctrl+,)" onClick={() => handleOpenSettings('runners')} />
            </div>
            <span className="status-spacer" />
            <div className="status-info">
              <span>{stats.characters.toLocaleString()} 字符</span>
              <span>{stats.words.toLocaleString()} 词</span>
              <span>第 {cursor.line} 行，第 {cursor.column} 列</span>
              <span>{mode === 'source' ? 'Markdown 源码' : '所见即所得'}</span>
              {activePath && <span className={`autosave-status is-${autoSaveStatus}`} role="status">{autoSaveStatus === 'pending' ? '等待自动保存' : autoSaveStatus === 'saving' ? '正在保存…' : autoSaveStatus === 'error' ? '自动保存失败' : '已保存'}</span>}
              <span>UTF-8</span>
            </div>
          </footer>
        </section>

        {aiOpen && (
          <AiPanel
            editorRef={editorRef}
            markdown={markdown}
            documentKey={activePath || activeTabId}
            documentTitle={documentTitle}
            initialAction={aiAction}
            onClose={() => setAiOpen(false)}
            onSelectLine={(line) => editorRef.current?.selectLine(line)}
            onOpenSettings={handleOpenSettings}
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
                ['首选项与设置', 'Ctrl + ,'],
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
        <div
          className="preview-backdrop"
          role="presentation"
          onMouseDown={() => {
            setDownloadMenuOpen(false)
            setPreview(null)
          }}
        >
          <section
            className="preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={preview.kind === 'svg' ? preview.title : preview.alt}
            onMouseDown={(event) => {
              event.stopPropagation()
              if (downloadMenuOpen) setDownloadMenuOpen(false)
            }}
          >
            <div className="preview-dialog-header">
              <div className="preview-header-left">
                <span className="preview-title">{preview.kind === 'svg' ? preview.title : preview.alt}</span>
                <span className="preview-type-badge">{preview.kind === 'svg' ? 'Mermaid 流程图' : '图片'}</span>
              </div>
              <div className="preview-actions">
                <span className="preview-zoom-label" aria-live="polite">{Math.round(previewZoom * 100)}% · Ctrl + 滚轮缩放 / 拖拽平移</span>
                <button type="button" className="preview-zoom-button" aria-label="缩小预览" title="缩小预览 (Ctrl + -)" onClick={() => changePreviewZoom(-0.1)}>−</button>
                <button type="button" className="preview-zoom-button preview-zoom-reset" aria-label="重置预览缩放" title="重置 100%" onClick={() => setPreviewZoom(1)}>100%</button>
                <button type="button" className="preview-zoom-button" aria-label="放大预览" title="放大预览 (Ctrl + +)" onClick={() => changePreviewZoom(0.1)}>＋</button>
                <div className="preview-download-wrapper" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`preview-download-button${downloadMenuOpen ? ' is-active' : ''}`}
                    aria-haspopup="true"
                    aria-expanded={downloadMenuOpen}
                    onClick={() => setDownloadMenuOpen((current) => !current)}
                  >
                    下载 ▾
                  </button>
                  {downloadMenuOpen && (
                    <div className="preview-download-dropdown" role="menu">
                      <button
                        type="button"
                        className="preview-download-item"
                        role="menuitem"
                        onClick={() => void handleDownload('png')}
                      >
                        <span className="dropdown-icon">🖼️</span> 下载为 PNG 图片
                      </button>
                      {preview.kind === 'svg' && (
                        <button
                          type="button"
                          className="preview-download-item"
                          role="menuitem"
                          onClick={() => void handleDownload('svg')}
                        >
                          <span className="dropdown-icon">📐</span> 下载为 SVG 矢量图
                        </button>
                      )}
                      <button
                        type="button"
                        className="preview-download-item"
                        role="menuitem"
                        onClick={() => void handleDownload('jpeg')}
                      >
                        <span className="dropdown-icon">📷</span> 下载为 JPEG 图片
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="preview-close"
                  autoFocus
                  aria-label="关闭"
                  onClick={() => {
                    setDownloadMenuOpen(false)
                    setPreview(null)
                  }}
                >
                  关闭
                </button>
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
                <div
                  className="preview-zoom-content"
                  style={preview.kind === 'svg' ? { zoom: previewZoom } : undefined}
                >
                  {preview.kind === 'image' ? (
                    <img
                      src={preview.src}
                      alt={preview.alt}
                      draggable={false}
                      className="preview-normal-image"
                    />
                  ) : (
                    <div
                      className="preview-diagram-svg"
                      style={
                        preview.width && preview.height
                          ? { width: preview.width, height: preview.height }
                          : undefined
                      }
                      dangerouslySetInnerHTML={{ __html: preview.markup }}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
        onSettingsSaved={() => showNotice('设置已保存并生效')}
      />

      <VersionHistoryModal
        open={versionHistoryOpen}
        documentPath={activePath}
        onClose={() => setVersionHistoryOpen(false)}
        onRestore={handleRestoreVersion}
      />

      {(updateState.status === 'available' ||
        updateState.status === 'downloading' ||
        updateState.status === 'downloaded') &&
        !updateBannerDismissed && (
          <div className="update-banner" role="status">
            <span className="update-banner-text">
              {updateState.status === 'available' && `发现新版本 v${updateState.version}，正在后台下载…`}
              {updateState.status === 'downloading' &&
                `正在下载新版本 v${updateState.version}… ${updateState.percent ?? 0}%`}
              {updateState.status === 'downloaded' && `新版本 v${updateState.version} 已就绪`}
            </span>
            {updateState.status === 'downloaded' ? (
              <button
                type="button"
                className="update-banner-btn is-primary"
                onClick={() => void window.desktop.installUpdate()}
              >
                立即重启安装
              </button>
            ) : (
              <button
                type="button"
                className="update-banner-btn"
                onClick={() => handleOpenSettings('about')}
              >
                查看详情
              </button>
            )}
            <button
              type="button"
              className="update-banner-btn"
              aria-label="关闭更新提示"
              onClick={() => setUpdateBannerDismissed(true)}
            >
              稍后
            </button>
          </div>
        )}

      {runnerDialog && (
        <CodeRunnerDialog
          language={runnerDialog.language}
          initialCode={runnerDialog.code}
          workingDirectory={runnerDialog.workingDirectory}
          onClose={() => setRunnerDialog(null)}
          onNotice={showNotice}
        />
      )}

      {notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}
    </div>
  )
}
