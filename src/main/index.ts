import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, nativeTheme, shell, webContents } from 'electron'
import HTMLtoDOCX from '@turbodocx/html-to-docx'
import { watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  copyImageAsset,
  createDirectory,
  createMarkdownFile,
  isMarkdownPath,
  listWorkspace,
  readMarkdown,
  renameNode,
  resolveLinkedDocument,
  writeMarkdown,
} from './file-service'
import { AiService } from './ai-service'
import { buildApplicationMenu } from './menu'
import { RecentService } from './recent-service'
import { RecoveryService } from './recovery-service'
import { SettingsService } from './settings-service'
import { RunnerService } from './runner-service'
import { UpdateService } from './update-service'
import { VersionService } from './version-service'
import { initAppLogger } from './logger'
import type {
  AiRequest,
  AiSettingsInput,
  AppSettings,
  DocumentSaveReason,
  ExecutionRequest,
  OpenedDocument,
  RecoverySnapshot,
  WorkspaceSelection,
} from '../shared/types'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isPrimaryInstance = app.requestSingleInstanceLock()
let pendingOpenPath: string | null = findMarkdownArgument(process.argv)
let recoveryService: RecoveryService
let recentService: RecentService
let aiService: AiService
let settingsService: SettingsService
let runnerService: RunnerService
let updateService: UpdateService
let versionService: VersionService

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
// 注意：曾使用 in-process-gpu，与 sandbox:false 组合在部分驱动下会扩大渲染进程原生崩溃面（切换文档易触发），故移除。

// 本机转储原生崩溃 minidump（不联网上传），结合日志共同确保异常有迹可查：
// 转储位置 = app.getPath('crashDumps')（默认 userData/Crashpad/reports）
crashReporter.start({ submitURL: '', uploadToServer: false })

// 日志：优先安装目录，写入失败自动回退用户数据目录（见 logger.ts）
const appLogger = initAppLogger(
  path.join(app.getAppPath(), 'logs'),
  path.join(app.getPath('userData'), 'logs'),
)

process.on('uncaughtException', (error) => {
  appLogger.error('主进程未捕获异常', { name: error?.name, message: error?.message, stack: error?.stack })
})
process.on('unhandledRejection', (reason) => {
  appLogger.error('主进程未处理的 Promise 拒绝', { reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason })
})

if (!isPrimaryInstance) {
  app.quit()
}

function findMarkdownArgument(args: string[]): string | null {
  const argument = args
    .map((item) => item.replace(/^"|"$/g, ''))
    .find((item) => !item.startsWith('-') && isMarkdownPath(item))
  return argument ? path.resolve(argument) : null
}

// ============================================================================
// 单进程多窗口：每个 BrowserWindow 拥有独立的工作区/文档监视状态，
// 从而支持同时打开多个 md 文件（各占一个窗口）。
// ============================================================================

type WindowState = {
  window: BrowserWindow
  workspaceRoot: string | null
  workspaceWatcher: FSWatcher | null
  workspaceDebounceTimer: NodeJS.Timeout | null
  watchedFile: string | null
  fileWatcher: FSWatcher | null
  lastSelfWriteTime: number
  lastSelfWritePath: string
  documentDebounceTimer: NodeJS.Timeout | null
}

const windowStates = new Map<number, WindowState>()

function stateForSender(sender: Electron.WebContents): WindowState | null {
  return windowStates.get(sender.id) ?? null
}

function getFocusedState(): WindowState | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) {
    const byFocused = windowStates.get(focused.webContents.id)
    if (byFocused) return byFocused
  }
  return windowStates.values().next().value ?? null
}

function isTrustedSender(sender: Electron.WebContents): boolean {
  return stateForSender(sender) !== null
}

function watchDocument(filePath: string, state: WindowState): void {
  state.fileWatcher?.close()
  if (state.documentDebounceTimer) clearTimeout(state.documentDebounceTimer)
  const resolvedPath = path.resolve(filePath)
  state.watchedFile = resolvedPath
  state.fileWatcher = watch(resolvedPath, { persistent: false }, () => {
    if (state.documentDebounceTimer) clearTimeout(state.documentDebounceTimer)
    state.documentDebounceTimer = setTimeout(() => {
      // 避免自身保存操作引发的虚假外部更新广播
      if (resolvedPath === state.lastSelfWritePath && Date.now() - state.lastSelfWriteTime < 1200) {
        return
      }
      if (state.window && !state.window.isDestroyed() && state.watchedFile === resolvedPath) {
        state.window.webContents.send('file-changed', resolvedPath)
      }
    }, 200)

    setTimeout(() => {
      if (state.watchedFile === resolvedPath) {
        try { watchDocument(resolvedPath, state) } catch { /* 文件可能已被删除 */ }
      }
    }, 250)
  })
}

function watchWorkspace(root: string, state: WindowState): void {
  state.workspaceWatcher?.close()
  state.workspaceWatcher = null
  if (!root) return

  try {
    state.workspaceWatcher = watch(root, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (filename && (
        filename.includes('.git') ||
        filename.includes('node_modules') ||
        filename.includes('.markdown-desk') ||
        filename.endsWith('.tmp') ||
        filename.endsWith('~')
      )) {
        return
      }

      if (state.workspaceDebounceTimer) clearTimeout(state.workspaceDebounceTimer)
      state.workspaceDebounceTimer = setTimeout(async () => {
        if (!state.window || state.window.isDestroyed() || !state.workspaceRoot) return
        try {
          const tree = await listWorkspace(state.workspaceRoot)
          sendWorkspaceSelection(tree, state)
        } catch {
          // ignore transient scan errors
        }
      }, 300)
    })
  } catch (err) {
    console.warn('Failed to watch workspace:', err)
  }
}

function setAndWatchWorkspace(root: string | null, state: WindowState): void {
  if (!root) {
    state.workspaceRoot = null
    state.workspaceWatcher?.close()
    state.workspaceWatcher = null
    return
  }
  const resolved = path.resolve(root)
  state.workspaceRoot = resolved
  watchWorkspace(resolved, state)
}

function sendWorkspaceSelection(tree: WorkspaceSelection['tree'], state: WindowState): void {
  if (state.window && !state.window.isDestroyed() && state.workspaceRoot) {
    state.window.webContents.send('workspace-selected', { root: state.workspaceRoot, tree })
  }
}

// 注意：buildApplicationMenu 依赖路径可能因使用场景不同而改变，这里广播的主管线保持稳定。
async function updateApplicationMenu(): Promise<void> {
  const recentFiles = recentService ? await recentService.getRecentFiles() : []
  const menu = buildApplicationMenu(() => getFocusedState()?.window ?? null, {
    recentFiles,
    onOpenRecent: (filePath) => {
      void openMarkdownFile(filePath)
    },
    onClearRecent: async () => {
      if (recentService) {
        await recentService.clearRecentFiles()
        await updateApplicationMenu()
      }
    },
  })
  Menu.setApplicationMenu(menu)
}

async function openMarkdownDialog(state: WindowState): Promise<void> {
  if (!state.window || state.window.isDestroyed()) {
    return
  }

  const result = await dialog.showOpenDialog(state.window, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
    title: '打开 Markdown 文件',
  })
  const selectedPath = result.filePaths[0]
  if (result.canceled || !selectedPath || !isMarkdownPath(selectedPath)) {
    return
  }

  await openMarkdownFile(selectedPath, state)
}

async function chooseWorkspace(state: WindowState): Promise<string | null> {
  if (!state.window || state.window.isDestroyed()) {
    return null
  }

  const result = await dialog.showOpenDialog(state.window, {
    properties: ['openDirectory'],
    title: '选择 Markdown 工作区',
  })
  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  setAndWatchWorkspace(result.filePaths[0], state)
  if (state.workspaceRoot) {
    const tree = await listWorkspace(state.workspaceRoot)
    sendWorkspaceSelection(tree, state)
  }
  return state.workspaceRoot
}

/**
 * 打开 Markdown 文件（单窗口多标签语义）：未指定目标窗口时，在当前窗口打开；
 * 指定目标窗口时，在目标窗口内打开（菜单/对话框/文件树导航）。
 */
async function openMarkdownFile(filePath: string, targetState?: WindowState | null): Promise<void> {
  if (!isMarkdownPath(filePath)) return
  const resolvedPath = path.resolve(filePath)

  if (!targetState) {
    const target = getFocusedState() ?? windowStates.values().next().value ?? null
    if (!target) {
      await createWindow(resolvedPath)
      return
    }
    if (target.window.isMinimized()) target.window.restore()
    target.window.focus()
    await openMarkdownFile(resolvedPath, target)
    return
  }

  const state = targetState
  if (!state.workspaceRoot || !resolvedPath.toLowerCase().startsWith(state.workspaceRoot.toLowerCase())) {
    setAndWatchWorkspace(path.dirname(resolvedPath), state)
  }
  try {
    const content = await readMarkdown(state.workspaceRoot || path.dirname(resolvedPath), resolvedPath)
    watchDocument(resolvedPath, state)
    if (!state.window.isDestroyed()) {
      state.window.webContents.send('document-opened', { path: resolvedPath, content } satisfies OpenedDocument)
    }
    appLogger.info('打开 Markdown 文档', { path: resolvedPath })
    if (recentService) {
      await recentService.addRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
    if (state.workspaceRoot) {
      try {
        const tree = await listWorkspace(state.workspaceRoot)
        sendWorkspaceSelection(tree, state)
      } catch {
        // 工作区目录扫描失败时（如系统临时目录权限限制），不影响当前文档正常打开
      }
    }
  } catch (error) {
    if (recentService) {
      await recentService.removeRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
    const message = error instanceof Error ? error.message : String(error)
    appLogger.error('打开 Markdown 文档失败', { path: resolvedPath, message })
    if (state.window && !state.window.isDestroyed()) {
      dialog.showMessageBox(state.window, {
        type: 'warning',
        title: '无法打开文件',
        message: `无法打开 Markdown 文件：\n${resolvedPath}\n\n原因：${message}`,
      })
    }
  }
}

async function createWindow(initialPath: string | null = null): Promise<WindowState> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Windows 上的 Electron 沙箱渲染进程在目标环境中无法启动；其余安全边界由隔离上下文、CSP 和白名单 IPC 保留。
      sandbox: false,
    },
  })
  const windowId = window.webContents.id
  const state: WindowState = {
    window,
    workspaceRoot: null,
    workspaceWatcher: null,
    workspaceDebounceTimer: null,
    watchedFile: null,
    fileWatcher: null,
    lastSelfWriteTime: 0,
    lastSelfWritePath: '',
    documentDebounceTimer: null,
  }
  windowStates.set(windowId, state)

  window.on('closed', () => {
    windowStates.delete(windowId)
    if (state.documentDebounceTimer) clearTimeout(state.documentDebounceTimer)
    if (state.workspaceDebounceTimer) clearTimeout(state.workspaceDebounceTimer)
    state.fileWatcher?.close()
    state.workspaceWatcher?.close()
    state.watchedFile = null
    state.workspaceRoot = null
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    appLogger.error('渲染进程页面加载失败', { errorCode, errorDescription, validatedURL, isMainFrame })
    if (isMainFrame) {
      console.error(`Renderer 加载失败 (${errorCode}): ${errorDescription} - ${validatedURL}`)
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    appLogger.error('渲染进程异常终止（render-process-gone）', {
      reason: details.reason,
      exitCode: details.exitCode,
      pid: details.pid,
    })
    if (details.reason !== 'clean-exit' && window && !window.isDestroyed()) {
      dialog.showMessageBox(window, {
        type: 'error',
        title: '编辑窗口异常中断',
        message: `编辑器渲染进程异常终止 (${details.reason})，即将自动重新加载以恢复编辑区。`,
      }).then(() => {
        if (window && !window.isDestroyed()) {
          window.reload()
        }
      }).catch(() => undefined)
    }
  })
  window.webContents.on('unresponsive', () => {
    appLogger.error('渲染进程无响应（unresponsive）', { pid: window.webContents.getOSProcessId() })
  })

  try {
    if (process.env.ELECTRON_RENDERER_URL) {
      await window.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      await window.loadFile(path.join(currentDirectory, '../renderer/index.html'))
    }
  } catch (error) {
    appLogger.error('窗口加载失败', { message: error instanceof Error ? error.message : String(error) })
  }

  if (initialPath) {
    // 等待渲染进程完成挂载并注册 IPC 监听，避免 document-opened 事件在订阅前到达而丢失
    setTimeout(() => {
      if (window.isDestroyed()) return
      void openMarkdownFile(initialPath, state)
    }, 150)
  }
  return state
}

const LANGUAGE_ALIASES: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  ps1: 'powershell',
  golang: 'go',
  rs: 'rust',
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

async function inlineLocalImageSources(html: string): Promise<string> {
  const pattern = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi
  let cursor = 0
  let result = ''
  for (const match of html.matchAll(pattern)) {
    const index = match.index ?? cursor
    const source = match[3]
    let replacement = match[0]
    if (/^file:/i.test(source)) {
      const imagePath = fileURLToPath(new URL(source))
      const mimeType = IMAGE_MIME_TYPES[path.extname(imagePath).toLowerCase()]
      if (!mimeType) throw new Error(`Word 导出不支持此图片格式：${path.extname(imagePath) || '未知格式'}`)
      const imageData = await readFile(imagePath)
      replacement = `${match[1]}${match[2]}data:${mimeType};base64,${imageData.toString('base64')}${match[2]}`
    }
    result += html.slice(cursor, index) + replacement
    cursor = index + match[0].length
  }
  return result + html.slice(cursor)
}

function registerIpc(): void {
  ipcMain.handle('workspace:choose', async (event) => {
    const state = stateForSender(event.sender)
    if (!state) return null
    return chooseWorkspace(state)
  })

  ipcMain.handle('workspace:list', async (event, root: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    setAndWatchWorkspace(root, state)
    if (!state.workspaceRoot) return []
    return listWorkspace(state.workspaceRoot)
  })

  ipcMain.handle('file:show-in-folder', async (event, filePath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    shell.showItemInFolder(path.resolve(filePath))
  })

  ipcMain.handle('file:rename', async (event, oldPath: string, newName: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    const resolvedOld = path.resolve(oldPath)
    const resolvedNew = await renameNode(resolvedOld, newName)
    if (state.watchedFile === resolvedOld) {
      watchDocument(resolvedNew, state)
    }
    if (recentService) {
      await recentService.removeRecentFile(resolvedOld)
      await recentService.addRecentFile(resolvedNew)
      await updateApplicationMenu()
    }
    if (state.workspaceRoot) {
      const tree = await listWorkspace(state.workspaceRoot)
      sendWorkspaceSelection(tree, state)
    }
    return resolvedNew
  })

  ipcMain.handle('file:trash', async (event, filePath: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    const resolved = path.resolve(filePath)
    await shell.trashItem(resolved)
    if (recentService) {
      await recentService.removeRecentFile(resolved)
      await updateApplicationMenu()
    }
    if (state.workspaceRoot) {
      const tree = await listWorkspace(state.workspaceRoot)
      sendWorkspaceSelection(tree, state)
    }
    return true
  })

  ipcMain.handle('file:create-file', async (event, directoryPath: string, fileName: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    const created = await createMarkdownFile(directoryPath, fileName)
    if (state.workspaceRoot) {
      const tree = await listWorkspace(state.workspaceRoot)
      sendWorkspaceSelection(tree, state)
    }
    return created
  })

  ipcMain.handle('file:create-folder', async (event, directoryPath: string, folderName: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    const created = await createDirectory(directoryPath, folderName)
    if (state.workspaceRoot) {
      const tree = await listWorkspace(state.workspaceRoot)
      sendWorkspaceSelection(tree, state)
    }
    return created
  })

  ipcMain.handle('file:open-dialog', async (event) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    await openMarkdownDialog(state)
  })

  ipcMain.handle('file:open-path', async (event, filePath: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    await openMarkdownFile(filePath, state)
  })

  ipcMain.handle('file:resolve-path', async (event, baseDir: string, targetPath: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    return resolveLinkedDocument(baseDir, targetPath, state.workspaceRoot)
  })

  ipcMain.handle('system:open-external', async (event, url: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    if (/^(?:https?|mailto):/i.test(url)) {
      await shell.openExternal(url)
      return true
    }
    return false
  })

  ipcMain.handle('file:read', async (event, filePath: string) => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    const resolvedPath = path.resolve(filePath)
    if (!state.workspaceRoot) {
      state.workspaceRoot = path.dirname(resolvedPath)
    }
    const content = await readMarkdown(state.workspaceRoot, resolvedPath)
    watchDocument(resolvedPath, state)
    if (recentService) {
      await recentService.addRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
    return content
  })

  ipcMain.handle('document-versions:list', async (event, filePath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return versionService.list(path.resolve(filePath))
  })

  ipcMain.handle('document-versions:read', async (event, filePath: string, versionId: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return versionService.read(path.resolve(filePath), versionId)
  })

  ipcMain.handle('file:write', async (event, filePath: string, content: string, reason: DocumentSaveReason = 'manual') => {
    const state = stateForSender(event.sender)
    if (!state) throw new Error('未授权的请求')
    const resolvedPath = path.resolve(filePath)
    if (!state.workspaceRoot) {
      state.workspaceRoot = path.dirname(resolvedPath)
    }
    const saveReason = reason === 'auto' || reason === 'restore' ? reason : 'manual'
    await versionService.captureBeforeWrite(resolvedPath, content, saveReason)
    state.lastSelfWritePath = resolvedPath
    state.lastSelfWriteTime = Date.now()
    await writeMarkdown(state.workspaceRoot, resolvedPath, content)
    watchDocument(resolvedPath, state)
    if (recentService) {
      await recentService.addRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
  })

  ipcMain.handle('file:save-as', async (event, sourcePath: string, content: string) => {
    const state = stateForSender(event.sender)
    if (!state || state.window.isDestroyed()) throw new Error('未授权的请求')
    const result = await dialog.showSaveDialog(state.window, {
      defaultPath: sourcePath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return null

    const targetPath = path.resolve(isMarkdownPath(result.filePath) ? result.filePath : `${result.filePath}.md`)
    state.workspaceRoot = path.dirname(targetPath)
    await versionService.captureBeforeWrite(targetPath, content, 'manual')
    state.lastSelfWritePath = targetPath
    state.lastSelfWriteTime = Date.now()
    await writeMarkdown(state.workspaceRoot, targetPath, content)
    watchDocument(targetPath, state)
    if (recentService) {
      await recentService.addRecentFile(targetPath)
      await updateApplicationMenu()
    }
    return { path: targetPath, content } satisfies OpenedDocument
  })

  ipcMain.handle('recent:get', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return recentService ? recentService.getRecentFiles() : []
  })

  ipcMain.handle('recent:clear', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    if (recentService) {
      await recentService.clearRecentFiles()
      await updateApplicationMenu()
    }
  })

  ipcMain.handle('asset:copy', async (event, sourcePath: string, root: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return copyImageAsset(sourcePath, root)
  })

  ipcMain.handle('file:export-html', async (event, sourcePath: string, html: string) => {
    const state = stateForSender(event.sender)
    if (!state || state.window.isDestroyed()) return false
    const suggestedPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.html`)
    const result = await dialog.showSaveDialog(state.window, {
      defaultPath: suggestedPath,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, html, 'utf8')
    return true
  })

  ipcMain.handle('file:export-pdf', async (event, sourcePath: string, html: string) => {
    const state = stateForSender(event.sender)
    if (!state || state.window.isDestroyed()) return false
    const suggestedPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`)
    const result = await dialog.showSaveDialog(state.window, {
      defaultPath: suggestedPath,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return false

    const exportWindow = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    try {
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await exportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      await writeFile(result.filePath, pdf)
      return true
    } finally {
      exportWindow.close()
    }
  })

  ipcMain.handle('file:export-docx', async (event, sourcePath: string, html: string) => {
    const state = stateForSender(event.sender)
    if (!state || state.window.isDestroyed()) return false
    const suggestedPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.docx`)
    const result = await dialog.showSaveDialog(state.window, {
      defaultPath: suggestedPath,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    })
    if (result.canceled || !result.filePath) return false

    const htmlWithImages = await inlineLocalImageSources(html)
    const document = await HTMLtoDOCX(htmlWithImages, null, {
      title: path.basename(sourcePath, path.extname(sourcePath)),
      creator: '墨笺',
      lang: 'zh-CN',
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      imageProcessing: { svgHandling: 'native', suppressSharpWarning: true },
    })
    const bytes = Buffer.isBuffer(document)
      ? document
      : document instanceof ArrayBuffer
        ? Buffer.from(document)
        : Buffer.from(await document.arrayBuffer())
    await writeFile(result.filePath, bytes)
    return true
  })

  ipcMain.handle('file:print', async (event) => {
    const state = stateForSender(event.sender)
    if (!state || state.window.isDestroyed()) return false
    if (!state.window) return false
    return new Promise<boolean>((resolve) => {
      state.window?.webContents.print({ silent: false, printBackground: true }, (success) => resolve(success))
    })
  })

  ipcMain.handle('recovery:write', async (event, snapshot: RecoverySnapshot) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    await recoveryService.write(snapshot)
  })

  ipcMain.handle('recovery:read', async (event, documentPath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return recoveryService.read(documentPath)
  })

  ipcMain.handle('recovery:clear', async (event, documentPath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    await recoveryService.clear(documentPath)
  })

  ipcMain.handle('ai:settings:get', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return aiService.getSettings()
  })

  ipcMain.handle('ai:settings:save', async (event, settings: AiSettingsInput) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return aiService.saveSettings(settings)
  })

  ipcMain.handle('ai:writing-memory:get', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return aiService.getWritingMemory()
  })

  ipcMain.handle('ai:writing-memory:save', async (event, memory: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    await aiService.saveWritingMemory(memory)
  })

  ipcMain.handle('ai:writing-memory:learn', async (event, sample: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return aiService.learnWritingMemory(sample)
  })

  ipcMain.handle('ai:request:start', async (event, request: AiRequest) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return aiService.start(request, event.sender)
  })

  ipcMain.handle('ai:request:cancel', async (event, requestId: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    await aiService.cancel(requestId)
  })

  ipcMain.handle('settings:get', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return settingsService.getSettings()
  })

  ipcMain.handle('settings:update', async (event, partial: Partial<AppSettings>) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return settingsService.updateSettings(partial)
  })

  // 应用主题同步：渲染进程切换浅色/深色后，同步 nativeTheme，使系统标题栏等原生 UI 跟随
  ipcMain.handle('app:theme', (event, theme: unknown) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    if (theme === 'dark' || theme === 'light') {
      nativeTheme.themeSource = theme
    }
  })

  ipcMain.handle('app:log', (event, level: unknown, message: unknown, meta: unknown) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const safeLevel = level === 'warn' || level === 'error' ? level : 'info'
    const safeMessage = typeof message === 'string' ? message : String(message ?? '')
    appLogger[safeLevel](`[renderer] ${safeMessage}`, meta)
  })

  ipcMain.handle('runner:detect-env', async (event, forceRefresh?: boolean) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return runnerService.detectEnvironments(Boolean(forceRefresh))
  })

  ipcMain.handle('runner:execute', async (event, request: ExecutionRequest) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const settings = await settingsService.getSettings()
    const rawLang = (request.language || '').toLowerCase().trim()
    const lang = LANGUAGE_ALIASES[rawLang] || rawLang
    const runner =
      settings.runners[lang] ||
      settings.runners[rawLang] ||
      Object.values(settings.runners).find(
        (r) =>
          r.language === lang ||
          r.id === lang ||
          r.language === rawLang ||
          r.id === rawLang
      )
    if (!runner || !runner.enabled) {
      return {
        executionId: request.executionId,
        stdout: '',
        stderr: `未找到语言 "${request.language}" 的已启用执行器，请在设置中配置。`,
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
        error: 'Runner not found or disabled',
      }
    }
    return runnerService.executeCode(request, runner)
  })

  ipcMain.handle('runner:cancel', async (event, executionId: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return runnerService.cancel(executionId)
  })

  ipcMain.handle('update:check', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return updateService.check()
  })

  ipcMain.handle('update:install', (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    updateService.install()
  })

  ipcMain.handle('update:get-state', (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return updateService.getState()
  })
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  try {
    appLogger.info('墨笺启动', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      devUrl: Boolean(process.env.ELECTRON_RENDERER_URL),
      logDirectory: appLogger.getLogDirectory(),
    })
    recoveryService = new RecoveryService(app.getPath('userData'))
    versionService = new VersionService(app.getPath('userData'))
    recentService = new RecentService(app.getPath('userData'), 20)
    aiService = new AiService(app.getPath('userData'))
    settingsService = new SettingsService(app.getPath('userData'))
    runnerService = new RunnerService()
    updateService = new UpdateService({
      broadcast: (state) => {
        for (const contents of webContents.getAllWebContents()) {
          contents.send('update-state', state)
        }
      },
      log: (level, message, meta) => appLogger[level](message, meta),
    })
    updateService.scheduleAutoCheck()
    registerIpc()
    const initialPath = pendingOpenPath
    pendingOpenPath = null
    await createWindow(initialPath)
    await updateApplicationMenu()

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow()
        await updateApplicationMenu()
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('墨笺启动失败:', error)
    dialog.showErrorBox('墨笺启动失败', `无法加载编辑器界面。\n\n${message}`)
    app.quit()
  }
})

if (isPrimaryInstance) {
  // 单实例：第二个实例（如「用墨笺打开」另一文件）退出，由当前窗口打开新的文档标签
  app.on('second-instance', (_event, commandLine) => {
    const filePath = findMarkdownArgument(commandLine)
    if (!filePath) {
      const state = getFocusedState()
      if (state) {
        if (state.window.isMinimized()) state.window.restore()
        state.window.focus()
      }
      return
    }
    void openMarkdownFile(filePath).catch((error) => console.error('打开 Markdown 文件失败:', error))
  })
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!isMarkdownPath(filePath)) return
  if (windowStates.size === 0) {
    pendingOpenPath = path.resolve(filePath)
    return
  }
  void openMarkdownFile(filePath).catch((error) => console.error('打开 Markdown 文件失败:', error))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('open-external', (event, url: string) => {
  if (!isTrustedSender(event.sender)) return
  if (url.startsWith('https://')) void shell.openExternal(url)
})
