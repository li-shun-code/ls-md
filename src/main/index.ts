import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { writeFile } from 'node:fs/promises'
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
import { initAppLogger } from './logger'
import type {
  AiRequest,
  AiSettingsInput,
  AppSettings,
  ExecutionRequest,
  OpenedDocument,
  RecoverySnapshot,
  WorkspaceSelection,
} from '../shared/types'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isPrimaryInstance = app.requestSingleInstanceLock()
let mainWindow: BrowserWindow | null = null
let workspaceRoot: string | null = null
let recoveryService: RecoveryService
let recentService: RecentService
let aiService: AiService
let settingsService: SettingsService
let runnerService: RunnerService
let watchedFile: string | null = null
let fileWatcher: FSWatcher | null = null
let pendingOpenPath: string | null = findMarkdownArgument(process.argv)

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
// 注意：曾使用 in-process-gpu，与 sandbox:false 组合在部分驱动下会扩大渲染进程原生崩溃面（切换文档易触发），故移除。

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

function isTrustedSender(sender: Electron.WebContents): boolean {
  return mainWindow !== null && sender === mainWindow.webContents
}

let workspaceWatcher: FSWatcher | null = null
let workspaceDebounceTimer: NodeJS.Timeout | null = null
let lastSelfWriteTime = 0
let lastSelfWritePath = ''
let documentDebounceTimer: NodeJS.Timeout | null = null

function watchDocument(filePath: string): void {
  fileWatcher?.close()
  if (documentDebounceTimer) clearTimeout(documentDebounceTimer)
  const resolvedPath = path.resolve(filePath)
  watchedFile = resolvedPath
  fileWatcher = watch(watchedFile, { persistent: false }, () => {
    if (documentDebounceTimer) clearTimeout(documentDebounceTimer)
    documentDebounceTimer = setTimeout(() => {
      // 避免自身保存操作引发的虚假外部更新广播
      if (resolvedPath === lastSelfWritePath && Date.now() - lastSelfWriteTime < 1200) {
        return
      }
      if (mainWindow && watchedFile === resolvedPath) {
        mainWindow.webContents.send('file-changed', watchedFile)
      }
    }, 200)

    setTimeout(() => {
      if (watchedFile === resolvedPath) {
        try { watchDocument(resolvedPath) } catch { /* 文件可能已被删除 */ }
      }
    }, 250)
  })
}

function watchWorkspace(root: string): void {
  workspaceWatcher?.close()
  workspaceWatcher = null
  if (!root) return

  try {
    workspaceWatcher = watch(root, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (filename && (
        filename.includes('.git') ||
        filename.includes('node_modules') ||
        filename.includes('.markdown-desk') ||
        filename.endsWith('.tmp') ||
        filename.endsWith('~')
      )) {
        return
      }

      if (workspaceDebounceTimer) clearTimeout(workspaceDebounceTimer)
      workspaceDebounceTimer = setTimeout(async () => {
        if (!mainWindow || !workspaceRoot) return
        try {
          const tree = await listWorkspace(workspaceRoot)
          sendWorkspaceSelection(tree)
        } catch {
          // ignore transient scan errors
        }
      }, 300)
    })
  } catch (err) {
    console.warn('Failed to watch workspace:', err)
  }
}

function setAndWatchWorkspace(root: string | null): void {
  if (!root) {
    workspaceRoot = null
    workspaceWatcher?.close()
    workspaceWatcher = null
    return
  }
  const resolved = path.resolve(root)
  workspaceRoot = resolved
  watchWorkspace(resolved)
}

function sendWorkspaceSelection(tree: WorkspaceSelection['tree']): void {
  if (mainWindow && workspaceRoot) {
    mainWindow.webContents.send('workspace-selected', { root: workspaceRoot, tree })
  }
}

async function chooseWorkspace(): Promise<string | null> {
  if (!mainWindow) {
    return null
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择 Markdown 工作区',
  })
  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  setAndWatchWorkspace(result.filePaths[0])
  if (workspaceRoot) {
    const tree = await listWorkspace(workspaceRoot)
    sendWorkspaceSelection(tree)
  }
  return workspaceRoot
}

async function openMarkdownDialog(): Promise<void> {
  if (!mainWindow) {
    return
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
    title: '打开 Markdown 文件',
  })
  const selectedPath = result.filePaths[0]
  if (result.canceled || !selectedPath || !isMarkdownPath(selectedPath)) {
    return
  }

  await openMarkdownFile(selectedPath)
}

async function updateApplicationMenu(): Promise<void> {
  const recentFiles = recentService ? await recentService.getRecentFiles() : []
  const menu = buildApplicationMenu(() => mainWindow, {
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

async function openMarkdownFile(filePath: string): Promise<void> {
  if (!isMarkdownPath(filePath)) return
  if (!mainWindow) {
    pendingOpenPath = path.resolve(filePath)
    return
  }

  const resolvedPath = path.resolve(filePath)
  if (!workspaceRoot || !resolvedPath.toLowerCase().startsWith(workspaceRoot.toLowerCase())) {
    setAndWatchWorkspace(path.dirname(resolvedPath))
  }
  try {
    const content = await readMarkdown(workspaceRoot || path.dirname(resolvedPath), resolvedPath)
    watchDocument(resolvedPath)
    mainWindow.webContents.send('document-opened', { path: resolvedPath, content } satisfies OpenedDocument)
    appLogger.info('打开 Markdown 文档', { path: resolvedPath })
    if (recentService) {
      await recentService.addRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
    if (workspaceRoot) {
      try {
        const tree = await listWorkspace(workspaceRoot)
        sendWorkspaceSelection(tree)
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '无法打开文件',
        message: `无法打开 Markdown 文件：\n${resolvedPath}\n\n原因：${message}`,
      })
    }
  }
}

async function createWindow(): Promise<void> {
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
  mainWindow = window

  window.on('closed', () => {
    if (mainWindow !== window) return
    fileWatcher?.close()
    fileWatcher = null
    workspaceWatcher?.close()
    workspaceWatcher = null
    watchedFile = null
    aiService?.cancelAll()
    mainWindow = null
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
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '编辑窗口异常中断',
        message: `编辑器渲染进程异常终止 (${details.reason})，即将自动重新加载以恢复编辑区。`,
      }).then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload()
        }
      }).catch(() => undefined)
    }
  })
  window.webContents.on('unresponsive', () => {
    appLogger.error('渲染进程无响应（unresponsive）', { pid: window.webContents.getOSProcessId() })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(path.join(currentDirectory, '../renderer/index.html'))
  }
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

function registerIpc(): void {
  ipcMain.handle('workspace:choose', async (event) => {
    if (!isTrustedSender(event.sender)) return null
    return chooseWorkspace()
  })

  ipcMain.handle('workspace:list', async (event, root: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    setAndWatchWorkspace(root)
    if (!workspaceRoot) return []
    return listWorkspace(workspaceRoot)
  })

  ipcMain.handle('file:show-in-folder', async (event, filePath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    shell.showItemInFolder(path.resolve(filePath))
  })

  ipcMain.handle('file:rename', async (event, oldPath: string, newName: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const resolvedOld = path.resolve(oldPath)
    const resolvedNew = await renameNode(resolvedOld, newName)
    if (watchedFile === resolvedOld) {
      watchDocument(resolvedNew)
    }
    if (recentService) {
      await recentService.removeRecentFile(resolvedOld)
      await recentService.addRecentFile(resolvedNew)
      await updateApplicationMenu()
    }
    if (workspaceRoot) {
      const tree = await listWorkspace(workspaceRoot)
      sendWorkspaceSelection(tree)
    }
    return resolvedNew
  })

  ipcMain.handle('file:trash', async (event, filePath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const resolved = path.resolve(filePath)
    await shell.trashItem(resolved)
    if (recentService) {
      await recentService.removeRecentFile(resolved)
      await updateApplicationMenu()
    }
    if (workspaceRoot) {
      const tree = await listWorkspace(workspaceRoot)
      sendWorkspaceSelection(tree)
    }
    return true
  })

  ipcMain.handle('file:create-file', async (event, directoryPath: string, fileName: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const created = await createMarkdownFile(directoryPath, fileName)
    if (workspaceRoot) {
      const tree = await listWorkspace(workspaceRoot)
      sendWorkspaceSelection(tree)
    }
    return created
  })

  ipcMain.handle('file:create-folder', async (event, directoryPath: string, folderName: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const created = await createDirectory(directoryPath, folderName)
    if (workspaceRoot) {
      const tree = await listWorkspace(workspaceRoot)
      sendWorkspaceSelection(tree)
    }
    return created
  })

  ipcMain.handle('file:open-dialog', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    await openMarkdownDialog()
  })

  ipcMain.handle('file:open-path', async (event, filePath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    await openMarkdownFile(filePath)
  })

  ipcMain.handle('file:resolve-path', async (event, baseDir: string, targetPath: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return resolveLinkedDocument(baseDir, targetPath, workspaceRoot)
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
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const resolvedPath = path.resolve(filePath)
    if (!workspaceRoot) {
      workspaceRoot = path.dirname(resolvedPath)
    }
    const content = await readMarkdown(workspaceRoot, resolvedPath)
    watchDocument(resolvedPath)
    if (recentService) {
      await recentService.addRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
    return content
  })

  ipcMain.handle('file:write', async (event, filePath: string, content: string) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const resolvedPath = path.resolve(filePath)
    if (!workspaceRoot) {
      workspaceRoot = path.dirname(resolvedPath)
    }
    lastSelfWritePath = resolvedPath
    lastSelfWriteTime = Date.now()
    await writeMarkdown(workspaceRoot, resolvedPath, content)
    watchDocument(resolvedPath)
    if (recentService) {
      await recentService.addRecentFile(resolvedPath)
      await updateApplicationMenu()
    }
  })

  ipcMain.handle('file:save-as', async (event, sourcePath: string, content: string) => {
    if (!isTrustedSender(event.sender) || !mainWindow) throw new Error('未授权的请求')
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: sourcePath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return null

    const targetPath = path.resolve(isMarkdownPath(result.filePath) ? result.filePath : `${result.filePath}.md`)
    workspaceRoot = path.dirname(targetPath)
    lastSelfWritePath = targetPath
    lastSelfWriteTime = Date.now()
    await writeMarkdown(workspaceRoot, targetPath, content)
    watchDocument(targetPath)
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
    if (!isTrustedSender(event.sender) || !mainWindow) return false
    const suggestedPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.html`)
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedPath,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, html, 'utf8')
    return true
  })

  ipcMain.handle('file:export-pdf', async (event, sourcePath: string, html: string) => {
    if (!isTrustedSender(event.sender) || !mainWindow) return false
    const suggestedPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`)
    const result = await dialog.showSaveDialog(mainWindow, {
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

  ipcMain.handle('file:print', async (event) => {
    if (!isTrustedSender(event.sender) || !mainWindow) return false
    return new Promise<boolean>((resolve) => {
      mainWindow?.webContents.print({ silent: false, printBackground: true }, (success) => resolve(success))
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

  ipcMain.handle('app:log', (event, level: unknown, message: unknown, meta: unknown) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const safeLevel = level === 'warn' || level === 'error' ? level : 'info'
    const safeMessage = typeof message === 'string' ? message : String(message ?? '')
    appLogger[safeLevel](`[renderer] ${safeMessage}`, meta)
  })

  ipcMain.handle('runner:detect-env', async (event) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    return runnerService.detectEnvironments()
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
    recentService = new RecentService(app.getPath('userData'), 20)
    aiService = new AiService(app.getPath('userData'))
    settingsService = new SettingsService(app.getPath('userData'))
    runnerService = new RunnerService()
    registerIpc()
    await createWindow()
    await updateApplicationMenu()

    if (pendingOpenPath) {
      const initialPath = pendingOpenPath
      pendingOpenPath = null
      await openMarkdownFile(initialPath)
    }

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('墨笺启动失败:', error)
    dialog.showErrorBox('墨笺启动失败', `无法加载编辑器界面。\n\n${message}`)
    app.quit()
  }
})

if (isPrimaryInstance) {
  app.on('second-instance', (_event, commandLine) => {
    const filePath = findMarkdownArgument(commandLine)
    if (!filePath) return
    if (!mainWindow) {
      pendingOpenPath = filePath
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    void openMarkdownFile(filePath).catch((error) => console.error('打开 Markdown 文件失败:', error))
  })
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!isMarkdownPath(filePath)) return
  if (!mainWindow) {
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
