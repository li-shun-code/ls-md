# 墨笺稳定性、日志、代码运行对话框与编辑体验优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立写入安装目录（失败回退用户目录）的日志体系以定位并修复渲染进程崩溃，重构代码执行为「对话框式」不污染文档，修复 Python 中文乱码与 Windows 下 bash 执行策略，并完成 Typora 对齐与 UI 打磨。

**Architecture:** Electron 主进程新增零依赖文件日志模块；渲染层经 preload 暴露的 `logToFile` 上报错误；代码执行从文档内嵌输出面板迁移为独立 `CodeRunnerDialog`（临时副本编辑，不写回文档）；`RunnerService` 统一处理环境变量注入与 Windows 平台适配。

**Tech Stack:** Electron 38 / React 19 / TypeScript 5.7 / electron-vite 3 / TipTap 3.30 (@tiptap/markdown) / CodeMirror 6 / Vitest / Node 内置 API（无新增依赖）

**Spec:** `docs/superpowers/specs/2026-09-04-editor-stability-logging-runner-ui-design.md`

## Global Constraints

- 不新增任何 npm 依赖（日志用 `fs/promises`；CodeMirror 复用现有 `@codemirror/*`、`@codemirror/language-data` 包）。
- 不改 `settings.json` 存储 schema；bash 的平台态适配全部在 `RunnerService` 内完成。
- 不含状态持久化的新 IPC 一律走「先校验 `isTrustedSender`，再抛错」的既有约定。
- 日志尽量不阻塞主流程：写入队列异步化，永不 `await` 阻塞事件循环热点路径。
- 中文 UI 文案、代码注释使用中文；日志消息中文。
- 每个任务结束时跑 `npm run typecheck` + `npm test`，全绿才提交。
- 提交粒度：每个任务一个 commit，遵循现有 `feat:`/`fix:` 前缀。

---

## Task 1: 日志模块 `src/main/logger.ts`（含单测）

**Files:**
- Create: `src/main/logger.ts`
- Test: `tests/logger.test.ts`

**Interfaces:**
- Consumes: 无（纯 Node API）
- Produces:
  ```ts
  export type LogLevel = 'info' | 'warn' | 'error'
  export type AppLogger = {
    info: (message: string, meta?: unknown) => void
    warn: (message: string, meta?: unknown) => void
    error: (message: string, meta?: unknown) => void
    flush: () => Promise<void>
    getLogDirectory: () => string
  }
  export type CreateLoggerOptions = { retentionDays?: number; forceFallback?: boolean }
  export function createFileLogger(primaryDirectory: string, fallbackDirectory: string, options?: CreateLoggerOptions): AppLogger
  export function initAppLogger(primaryDirectory: string, fallbackDirectory: string): AppLogger
  export function getAppLogger(): AppLogger | null
  export function decodeOutput(buffer: Buffer, platform?: NodeJS.Platform): string  // Task 9 使用
  ```

- [ ] **Step 1: 写失败测试 `tests/logger.test.ts`**

```ts
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileLogger } from '../src/main/logger'

describe('createFileLogger', () => {
  let tempDir: string
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'md-logger-test-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('写入主目录，行含 ISO 时间与级别，元数据以 JSON 呈现', async () => {
    const logDir = path.join(tempDir, 'logs')
    const fallback = path.join(tempDir, 'fallback')
    const logger = createFileLogger(logDir, fallback)
    logger.info('hello {name}', { name: 'world' })
    logger.error('boom', new Error('test error'))
    await logger.flush()

    const files = await readdir(logDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^markdown-desk-\d{4}-\d{2}-\d{2}\.log$/)
    const content = await readFile(path.join(logDir, files[0]), 'utf8')
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] \[INFO\] hello \{name\} \{"name":"world"\}/)
    expect(content).toContain('[ERROR] boom')
  })

  it('forceFallback 时直接写 fallback 目录并回显实际目录', async () => {
    const logDir = path.join(tempDir, 'logs')
    const fallback = path.join(tempDir, 'fallback')
    const logger = createFileLogger(logDir, fallback, { forceFallback: true })
    logger.warn('fell back')
    await logger.flush()
    expect(logger.getLogDirectory()).toBe(fallback)
    const files = await readdir(fallback)
    expect(files).toHaveLength(1)
  })

  it('过期的日志被清理、当天的日志保留', async () => {
    const logDir = path.join(tempDir, 'logs')
    const fallback = path.join(tempDir, 'fallback')
    await mkdir(logDir, { recursive: true })
    await writeFile(path.join(logDir, 'markdown-desk-2000-01-01.log'), 'ancient', 'utf8')

    const logger = createFileLogger(logDir, fallback, { retentionDays: 14 })
    logger.info('today')
    await logger.flush()

    const today = new Date().toISOString().slice(0, 10)
    const files = await readdir(logDir)
    expect(files.filter((f) => f.includes('2000-01-01'))).toHaveLength(0)
    expect(files.some((f) => f.includes(today))).toBe(true)
  })

  it('循环引用元数据不会抛错', async () => {
    const logDir = path.join(tempDir, 'logs')
    const fallback = path.join(tempDir, 'fallback')
    const logger = createFileLogger(logDir, fallback)
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    logger.error('circular', circular)
    await logger.flush()
    const files = await readdir(logDir)
    const content = await readFile(path.join(logDir, files[0]), 'utf8')
    expect(content).toContain('[ERROR] circular')
    expect(content).toContain('[Circular]')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL，`Cannot find module '../src/main/logger'`

- [ ] **Step 3: 实现 `src/main/logger.ts`**

```ts
import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

const LOG_FILE_PREFIX = 'markdown-desk-'
const DEFAULT_RETENTION_DAYS = 14

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function fileNameFor(now: Date): string {
  return `${LOG_FILE_PREFIX}${isoDate(now)}.log`
}

function safeStringify(meta: unknown): string {
  if (meta === undefined) return ''
  try {
    const serialized = JSON.stringify(meta)
    return serialized === undefined ? String(meta) : ` ${serialized}`
  } catch {
    const seen = new WeakSet()
    const replacer = (_key: string, value: unknown): unknown => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    }
    return ` ${JSON.stringify(meta, replacer)}`
  }
}

export type AppLogger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
  flush: () => Promise<void>
  getLogDirectory: () => string
}

export type CreateLoggerOptions = {
  retentionDays?: number
  /** 测试用：强制直接使用 fallback 目录 */
  forceFallback?: boolean
}

export function createFileLogger(
  primaryDirectory: string,
  fallbackDirectory: string,
  options?: CreateLoggerOptions,
): AppLogger {
  const retentionDays = options?.retentionDays ?? DEFAULT_RETENTION_DAYS
  let directory = options?.forceFallback ? fallbackDirectory : primaryDirectory
  let lastLoggedDay = ''
  let queue: Promise<unknown> = Promise.resolve()

  const enqueue = (task: () => Promise<unknown>): void => {
    queue = queue.then(task, task)
  }

  const ensurePrimary = async (): Promise<boolean> => {
    if (directory !== primaryDirectory) return false
    try {
      await mkdir(primaryDirectory, { recursive: true })
      return true
    } catch {
      directory = fallbackDirectory
      await mkdir(fallbackDirectory, { recursive: true }).catch(() => undefined)
      return false
    }
  }

  const pruneOldLogs = async (): Promise<void> => {
    try {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
      const entries = await readdir(directory)
      await Promise.all(
        entries
          .filter((entry) => entry.startsWith(LOG_FILE_PREFIX) && entry.endsWith('.log'))
          .map(async (entry) => {
            try {
              const fullPath = path.join(directory, entry)
              const info = await stat(fullPath)
              if (info.mtimeMs < cutoff) await rm(fullPath, { force: true })
            } catch { /* 单文件清理失败不影响其它 */ }
          }),
      )
    } catch { /* 目录不可读时忽略清理 */ }
  }

  const write = (level: LogLevel, message: string, meta?: unknown): void => {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${safeStringify(meta)}\n`
    enqueue(async () => {
      const primaryOk = await ensurePrimary()
      const now = new Date()
      if (isoDate(now) !== lastLoggedDay) {
        lastLoggedDay = isoDate(now)
        void pruneOldLogs()
      }
      try {
        await appendFile(path.join(directory, fileNameFor(now)), line, 'utf8')
      } catch {
        if (primaryOk) {
          // 主目录写入失败（如安装目录权限被回收）：回退到 userData 并重试一次
          directory = fallbackDirectory
          await mkdir(fallbackDirectory, { recursive: true }).catch(() => undefined)
          await appendFile(path.join(directory, fileNameFor(new Date())), line, 'utf8').catch(() => undefined)
        }
      }
    })
  }

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    flush: () => queue,
    getLogDirectory: () => directory,
  }
}

let appLoggerInstance: AppLogger | null = null

export function initAppLogger(primaryDirectory: string, fallbackDirectory: string): AppLogger {
  appLoggerInstance = createFileLogger(primaryDirectory, fallbackDirectory)
  return appLoggerInstance
}

export function getAppLogger(): AppLogger | null {
  return appLoggerInstance
}

/**
 * 输出解码兜底：优先 UTF-8；仅当结果含替换字符（\uFFFD）时在 Windows 下尝试 GBK。
 * Task 9（Python 中文乱码）使用。
 */
export function decodeOutput(buffer: Buffer, platform: NodeJS.Platform = process.platform): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8
  if (platform === 'win32') {
    try {
      return new TextDecoder('gbk', { fatal: false }).decode(buffer)
    } catch { /* 无 gbk 支持（极少数精简构建）则原样返回 */ }
  }
  return utf8
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/logger.test.ts`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/logger.ts tests/logger.test.ts
git commit -m "feat: 新增安装目录文件日志模块（含回退与轮转）"
```

---

## Task 2: 主进程日志接入（含渲染进程崩溃日志）

**Files:**
- Modify: `src/main/index.ts`（顶部 import、`app.whenReady` 前初始化、`createWindow` 事件、`registerIpc`、启动日志）
- Test: `src/main/logger.ts` 已由 Task 1 覆盖（本任务接入式改动不拆新单测）

**Interfaces:**
- Consumes: `initAppLogger(primary, fallback)`、`getAppLogger()`、`AppLogger`（Task 1）
- Produces:
  - 新 IPC channel：`app:log`，入参 `(level: string, message: string, meta?: unknown)` → 主进程写日志
  - `render-process-gone`/`did-fail-load`/`unresponsive`/`uncaughtException`/`unhandledRejection` 全部落盘

- [ ] **Step 1: 顶部引入并尽早初始化**

在 `src/main/index.ts` 的 import 区加入：

```ts
import { createFileLogger, initAppLogger } from './logger'
```

在现有 `app.disableHardwareAcceleration()` 之前（`app.requestSingleInstanceLock()` 之后即可）加入：

```ts
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
```

- [ ] **Step 2: 在 `createWindow` 中为崩溃事件落盘**

将现有 `window.webContents.on('did-fail-load', ...)` 与 `render-process-gone` 块替换为（保留原 reload 逻辑）：

```ts
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
```

- [ ] **Step 3: 注册 `app:log` IPC 与启动日志**

在 `registerIpc()` 内、`runner:detect-env` 之前加入：

```ts
  ipcMain.handle('app:log', (event, level: unknown, message: unknown, meta: unknown) => {
    if (!isTrustedSender(event.sender)) throw new Error('未授权的请求')
    const safeLevel = level === 'warn' || level === 'error' ? level : 'info'
    const safeMessage = typeof message === 'string' ? message : String(message ?? '')
    appLogger[safeLevel](`[renderer] ${safeMessage}`, meta)
  })
```

在 `app.whenReady().then(async () => {` 的 try 块开头（`recoveryService = ...` 之前）加入：

```ts
    appLogger.info('墨笺启动', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      devUrl: Boolean(process.env.ELECTRON_RENDERER_URL),
      logDirectory: appLogger.getLogDirectory(),
    })
```

同时在 `openMarkdownFile` 的 try 成功路径末尾与 catch 分支内各加一行落盘（catch 中原有 `dialog.showMessageBox` 保留）：

```ts
  // try 内（mainWindow.webContents.send('document-opened', ...) 之后）：
  appLogger.info('打开 Markdown 文档', { path: resolvedPath })
  // catch 内（showMessageBox 之前）：
  appLogger.error('打开 Markdown 文档失败', { path: resolvedPath, message })
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 无类型与 lint 错误；临时预览 `npm run dev` 打开后：创建 `logs/` 目录（安装路径为 `out` 相关目录时 app.getAppPath() 指向项目根，日志落在 `<项目>/logs/`；失败则回退 userData）。

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts
git commit -m "feat: 主进程全链路日志接入，渲染进程崩溃可落盘追溯"
```

---

## Task 3: preload 与渲染层日志上报 + 文档切换埋点

**Files:**
- Modify: `src/shared/types.ts`（DesktopBridge 增加 `logToFile`）
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`（无需，Task 2 已完成）
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/components/ErrorBoundary.tsx`
- Modify: `src/renderer/src/App.tsx`（`openDocument` 埋点）

**Interfaces:**
- Consumes: `app:log` IPC（Task 2）
- Produces: `DesktopBridge.logToFile(level, message, meta)`

- [ ] **Step 1: 扩展类型与 preload**

`src/shared/types.ts` 的 `DesktopBridge` 中加入：

```ts
  logToFile: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => Promise<void>
```

`src/preload/index.ts` 的 `desktopBridge` 中加入：

```ts
  logToFile: (level, message, meta) => ipcRenderer.invoke('app:log', level, message, meta),
```

- [ ] **Step 2: 渲染层全局错误上报**

`src/renderer/src/main.tsx` 替换整体为：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

const reportLog = (level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void => {
  void window.desktop?.logToFile?.(level, message, meta).catch(() => undefined)
}

window.addEventListener('error', (event) => {
  console.error('Window error captured:', event.error || event.message)
  reportLog('error', event.message || 'window error', {
    error: event.error instanceof Error ? { message: event.error.message, stack: event.error.stack } : event.error,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection captured:', event.reason)
  reportLog('error', 'unhandledrejection', {
    reason: event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : event.reason,
  })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
```

`src/renderer/src/components/ErrorBoundary.tsx` 的 `componentDidCatch` 追加（保留 `console.error`）：

```ts
  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo)
    void window.desktop?.logToFile?.('error', 'ErrorBoundary 捕获未处理异常', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    }).catch(() => undefined)
  }
```

- [ ] **Step 3: `openDocument` 切换埋点**

`src/renderer/src/App.tsx` 的 `openDocument` 内：try 块开头与 catch 各加日志：

```ts
    try {
      void window.desktop.logToFile?.('info', '切换文档', { filePath }).catch(() => undefined)
      const content = contentOverride ?? (await window.desktop.readMarkdown(filePath))
      ...
      void window.desktop.logToFile?.('info', '切换文档完成', {
        filePath,
        contentChars: content.length,
        recovered: Boolean(recoveryBanner),
      }).catch(() => undefined)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '打开文档失败')
      void window.desktop.logToFile?.('error', '切换文档失败', {
        filePath,
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined)
    }
```

（`recoveryBanner` 为本闭包变量，使用前需在读取 snapshot 后取值；可简化为只记录 `contentChars` 与路径。）

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: 全绿；手工检查：人为 `console.error` 一处错误后刷新渲染层，`<项目>/logs/` 中出现 `[renderer]` 前缀的 error 行。

- [ ] **Step 5: 提交**

```bash
git add src/shared/types.ts src/preload/index.ts src/renderer/src/main.tsx src/renderer/src/components/ErrorBoundary.tsx src/renderer/src/App.tsx
git commit -m "feat: 渲染层错误上报主进程日志，文档切换操作埋点"
```

---

## Task 4: 切换文档崩溃防御修复

**Files:**
- Modify: `src/renderer/src/components/MarkdownEditor.tsx`（mermaid node view `destroy`；`setContent` effect try/catch）
- Modify: `src/main/index.ts`（移除 `in-process-gpu` 开关）

**Interfaces:**
- Consumes: `window.desktop.logToFile`（Task 3）
- Produces: 防御性的 node view 销毁契约——mermaid node view 具备 `destroy()`，使 in-flight 渲染作废

- [ ] **Step 1: mermaid node view 增加 destroy**

`src/renderer/src/components/MarkdownEditor.tsx` 的 `createMermaidNodeView` 返回值对象中（`update` 之后）加入：

```ts
    destroy: () => {
      // 文档切换/节点销毁时作废进行中的 mermaid 渲染，避免在已分离 DOM 上继续写入
      renderVersion += 1
    },
```

- [ ] **Step 2: `setContent` 包 try/catch**

将现有 effect 替换（先更新 ref、再解析；失败保留旧文档并上报）：

```ts
  useEffect(() => {
    if (!editor || mode !== 'wysiwyg') return
    if (lastEditorMarkdownRef.current === markdown) return
    lastEditorMarkdownRef.current = markdown
    try {
      editor.commands.setContent(markdownForEditor(markdown, workspaceRoot), { emitUpdate: false, contentType: 'markdown' })
    } catch (error) {
      void window.desktop?.logToFile?.('error', 'Markdown 解析失败（setContent）', {
        message: error instanceof Error ? error.message : String(error),
        markdownChars: markdown.length,
        workspaceRoot,
      }).catch(() => undefined)
    }
  }, [editor, markdown, mode, workspaceRoot])
```

- [ ] **Step 3: 移除 `in-process-gpu` 开关**

`src/main/index.ts` 中删除：

```ts
app.commandLine.appendSwitch('in-process-gpu')
```

保留 `disableHardwareAcceleration()`、`disable-gpu`、`disable-gpu-compositing`，并在删除处注释说明：

```ts
// 注意：曾使用 in-process-gpu，与 sandbox:false 组合在部分驱动下会扩大渲染进程原生崩溃面，故移除。
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run lint`
手工验证：`npm run dev`，连续在文件树切换 10+ 个文档（包括含 mermaid 代码块、表格、图片的文档）；再用打包后应用验证。预期：无「编辑窗口异常中断」，`logs/` 中无 `render-process-gone` error。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/MarkdownEditor.tsx src/main/index.ts
git commit -m "fix: 切换文档崩溃防御——mermaid销毁防抖、setContent容错、移除in-process-gpu"
```

---

## Task 5: 代码运行对话框组件 `CodeRunnerDialog.tsx`

**Files:**
- Create: `src/renderer/src/components/CodeRunnerDialog.tsx`
- Test: 本任务以 typecheck 与手工验证为主（组件交互多、无浏览器环境不做单测；e2e 已有 `tests/e2e/code-runner.spec.ts` 结构可沿用，本任务不强行新增）

**Interfaces:**
- Consumes: `window.desktop.executeCode` / `window.desktop.cancelExecution`（已存在）、`@shared/types` 的 `ExecutionResult`/`ExecutionRequest`
- Produces:
  ```ts
  export type CodeRunnerDialogProps = {
    language: string
    initialCode: string
    workingDirectory?: string
    onClose: () => void
    onNotice: (message: string) => void
  }
  export function CodeRunnerDialog(props: CodeRunnerDialogProps): JSX.Element
  ```

- [ ] **Step 1: 实现组件**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, bracketMatching, indentOnInput, defaultHighlightStyle } from '@codemirror/language'
import { langs } from '@codemirror/language-data'
import { X, Play, Square } from 'lucide-react'
import type { ExecutionResult } from '@shared/types'

export type CodeRunnerDialogProps = {
  language: string
  initialCode: string
  workingDirectory?: string
  onClose: () => void
  onNotice: (message: string) => void
}

function languageExtension(language: string) {
  const normalized = language.trim().toLowerCase()
  switch (normalized) {
    case 'py': case 'python': return langs.python()
    case 'js': case 'javascript': case 'node': return langs.javascript()
    case 'ts': case 'typescript': return langs.typescript()
    case 'sh': case 'bash': case 'shell': case 'ps1': case 'powershell': return langs.shell()
    case 'go': case 'golang': return langs.go()
    case 'rs': case 'rust': return langs.rust()
    case 'java': return langs.java()
    case 'c': return langs.c()
    case 'cpp': case 'c++': return langs.cpp()
    case 'html': return langs.html()
    case 'css': return langs.css()
    case 'json': return langs.json()
    case 'sql': return langs.sql()
    case 'md': case 'markdown': return langs.markdown()
    default: return null
  }
}

type Phase = 'idle' | 'running' | 'done' | 'cancelled'

export function CodeRunnerDialog({ language, initialCode, workingDirectory, onClose, onNotice }: CodeRunnerDialogProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const executionIdRef = useRef<string | null>(null)
  const codeRef = useRef(initialCode)
  const runRef = useRef<() => void>(() => undefined)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // CodeMirror 编辑器（挂载一次；App 条件渲染保证每次打开是新实例）
  useEffect(() => {
    const host = editorHostRef.current
    if (!host) return
    const lang = languageExtension(language)
    const state = EditorState.create({
      doc: initialCode,
      extensions: [
        lang ?? [],
        lineNumbers(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: 'Mod-Enter', run: () => { runRef.current(); return true } },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) codeRef.current = update.state.doc.toString()
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
          '.cm-content': { padding: '12px 0' },
          '.cm-gutters': { background: 'transparent', borderRight: '1px solid var(--border)' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    view.focus()
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 组件随 App 条件渲染，语言/初始代码仅需挂载时生效
  }, [])

  const handleRun = useCallback(async () => {
    if (phase === 'running') return
    setPhase('running')
    setResult(null)
    const executionId = `run-dialog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    executionIdRef.current = executionId
    try {
      const r = await window.desktop.executeCode({
        executionId,
        language,
        code: codeRef.current,
        workingDirectory,
      })
      if (executionIdRef.current !== executionId) return
      setResult(r)
      setPhase('done')
    } catch (error) {
      if (executionIdRef.current !== executionId) return
      setResult({
        executionId,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        durationMs: 0,
        timedOut: false,
      })
      setPhase('done')
    }
  }, [language, phase, workingDirectory])
  runRef.current = handleRun

  const handleCancel = useCallback(() => {
    const id = executionIdRef.current
    if (!id) return
    void window.desktop.cancelExecution(id)
    executionIdRef.current = null
    setPhase('cancelled')
  }, [])

  const handleClose = useCallback(() => {
    if (phase === 'running') {
      const id = executionIdRef.current
      if (id) void window.desktop.cancelExecution(id)
    }
    onClose()
  }, [onClose, phase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleClose])

  const status =
    phase === 'running' ? { text: '运行中…', className: 'is-running' }
    : phase === 'cancelled' ? { text: '已终止', className: 'is-cancelled' }
    : !result ? { text: '就绪', className: 'is-idle' }
    : result.timedOut ? { text: '超时 (15s)', className: 'is-timeout' }
    : result.exitCode === 0 ? { text: '成功 (0)', className: 'is-success' }
    : { text: `失败 (${result.exitCode ?? 1})`, className: 'is-error' }

  return (
    <div className="modal-backdrop code-runner-backdrop" role="presentation" onMouseDown={handleClose}>
      <section
        className="code-runner-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="代码运行"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="code-runner-header">
          <div className="code-runner-title">
            <span className="code-runner-lang-badge">{language || 'text'}</span>
            <h2>代码运行</h2>
          </div>
          <button type="button" className="dialog-close" aria-label="关闭 (Esc)" onClick={handleClose}>×</button>
        </div>

        <div className="code-runner-editor" ref={editorHostRef} />

        <div className="code-runner-footer">
          <span className="code-runner-cwd" title={workingDirectory ?? ''}>
            {workingDirectory ? `工作目录：${workingDirectory}` : '工作目录：系统临时目录'}
          </span>
          <div className="code-runner-actions">
            {phase === 'running' ? (
              <button type="button" className="runner-action-btn is-stop" onClick={handleCancel}>
                <Square size={14} /> 终止
              </button>
            ) : (
              <button type="button" className="runner-action-btn is-run" onClick={() => void handleRun()}>
                <Play size={14} /> 运行 (Ctrl+Enter)
              </button>
            )}
            <button type="button" className="runner-action-btn is-ghost" onClick={handleClose}>关闭</button>
          </div>
        </div>

        {phase !== 'idle' && (
          <div className="code-runner-output-area">
            <div className="code-runner-output-meta">
              <span className={`code-runner-status ${status.className}`}>{status.text}</span>
              {result && result.durationMs > 0 && <span className="code-runner-duration">{result.durationMs}ms</span>}
            </div>
            {result?.error && !result.stdout && !result.stderr && (
              <pre className="runner-output runner-output-error">{result.error}</pre>
            )}
            {result?.stdout && <pre className="runner-output runner-output-stdout">{result.stdout}</pre>}
            {result?.stderr && <pre className="runner-output runner-output-stderr">{result.stderr}</pre>}
            {phase === 'done' && result && !result.stdout && !result.stderr && !result.error && (
              <pre className="runner-output runner-output-stdout is-muted">(执行完成，无输出)</pre>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 通过（如 `langs.shell()` 等 language-data API 类型不匹配，按实际导出调整类型；`langs` 为 `LanguageDescription` 集合，调用返回 `Extension`，必要时用 `import { languages } from '@codemirror/language-data'` 的 `.find` 方式替代）。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/CodeRunnerDialog.tsx
git commit -m "feat: 新增代码运行对话框组件（临时副本编辑、不写回文档）"
```

---

## Task 6: MarkdownEditor 重构——移除内嵌输出面板并提升运行按钮

**Files:**
- Modify: `src/renderer/src/components/MarkdownEditor.tsx`（node view 简化、props 增加 `onRunCode`）

**Interfaces:**
- Consumes: 无新依赖
- Produces:
  ```ts
  // MarkdownEditorProps 新增
  onRunCode?: (language: string, code: string, workingDirectory?: string) => void
  ```

- [ ] **Step 1: Props 增补与解构**

`MarkdownEditorProps` 类型中加入：

```ts
  onRunCode?: (language: string, code: string, workingDirectory?: string) => void
```

组件解构处（第 324 行区域）追加 `onRunCode`，并在 ref 同步区追加：

```ts
  const onRunCodeRef = useRef(onRunCode)
  onRunCodeRef.current = onRunCode
```

- [ ] **Step 2: 精简代码块 node view**

删除以下代码块内的全部输出面板/执行逻辑（现约 413-599 行的 `outputPanel`、`outputHeader`、`outputBody`、`statusBadge`、`durationBadge`、`collapseBtn`、`clearBtn`、`runCode` 函数及 `dom.classList.has-output` 等），并同步删除 `createNodeView` 中相关的 DOM 构建与事件绑定（约 390-487 行区域）。保留：`pre`、`gutter`、`code`、`toolbar`、`langBadge`、`runButton`、`copyButton`、`updateLineNumbers`。

替换「运行」按钮点击与快捷运行逻辑为：

```ts
          const triggerRun = () => {
            const snippet = code.textContent ?? ''
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
```

`destroy` 回调替换为（对话框场景运行归属对话框，此处仅兜底清理）：

```ts
            destroy: () => {
              // 运行已迁移至代码运行对话框；无内嵌进程需要在此取消
            },
```

`update` 方法保留行号/语言标签更新逻辑不变（`langBadge.textContent = formatLanguage(...)` 与 `updateLineNumbers(nextNode)`）。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 通过；确认代码块中不再引用 `outputPanel`/`runCode` 等已删变量（无未使用变量告警）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/MarkdownEditor.tsx
git commit -m "refactor: 移除文档内嵌代码输出面板，运行按钮提升为打开代码运行对话框"
```

---

## Task 7: App.tsx 接线代码运行对话框

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `tests/e2e/code-runner.spec.ts`（适配新交互，若断言依赖内嵌输出面板）

**Interfaces:**
- Consumes: `CodeRunnerDialog`（Task 5）、`MarkdownEditor.onRunCode`（Task 6）
- Produces: 渲染层 `runnerDialog` 状态机

- [ ] **Step 1: 状态与回调**

在 `App` 组件内、`settingsTab` state 附近加入：

```ts
type RunnerDialogState = {
  language: string
  code: string
  workingDirectory?: string
}
export type { RunnerDialogState } // 如 e2e 需要可导出；默认不导出
```

```ts
  const [runnerDialog, setRunnerDialog] = useState<RunnerDialogState | null>(null)

  const handleRunCode = useCallback((language: string, code: string, workingDirectory?: string) => {
    setAiOpen(false)
    setRunnerDialog({ language, code, workingDirectory })
  }, [])
```

在 `openDocument` 的 try 内（`setActivePath(filePath)` 之前）与 `newDocument` 内加入 `setRunnerDialog(null)`（切换文档时关闭对话框，避免语境错乱）。

- [ ] **Step 2: 传入编辑器并渲染对话框**

`<MarkdownEditor ...>`（第 712-724 行区域）追加：

```tsx
                onRunCode={handleRunCode}
```

在 `<SettingsModal .../>` 之后、`notice` 之前渲染：

```tsx
      {runnerDialog && (
        <CodeRunnerDialog
          language={runnerDialog.language}
          initialCode={runnerDialog.code}
          workingDirectory={runnerDialog.workingDirectory}
          onClose={() => setRunnerDialog(null)}
          onNotice={showNotice}
        />
      )}
```

同时更新 `import`：`import { CodeRunnerDialog } from '@renderer/components/CodeRunnerDialog'`

- [ ] **Step 3: 同步 e2e 断言**

`tests/e2e/code-runner.spec.ts` 中如存在针对文档内嵌输出面板（`.code-block-output` / `.code-output-status`）的断言，改为针对 `.code-runner-dialog` 中 `.code-runner-status` 与 `.runner-output-*` 的断言；先读取该文件确认后修改（无相关断言则跳过本步）。

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run lint && npx vitest run`
手工：`npm run dev` → 编辑含代码块的文档 → 点击「▶ 运行」→ 对话框打开、代码可编辑、修改后运行不影响原文档；Escape/关闭按钮正常；切换文档自动关闭对话框。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/App.tsx tests/e2e/code-runner.spec.ts
git commit -m "feat: 接线代码运行对话框到编辑器与应用状态"
```

---

## Task 8: 样式——清理旧输出面板、新增对话框样式

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 删除旧输出面板样式**

删除 `styles.css` 中以下类及对应的主题变体（根据现有行号所在区块整体移除）：
- `.code-block-output`、`.code-output-header`、`.code-output-status`（含 `-is-running/-is-error/-is-success/-is-timeout`）、`.code-output-duration`、`.code-output-btn`、`.code-output-body`、`.is-collapsed`、`.has-output`、`.code-output-stdout`、`.code-output-stderr`、`:has(.code-block-output)` 相关选择器

- [ ] **Step 2: 新增对话框与输出样式**

在 `.modal-backdrop` 体系附近追加（色彩变量沿用现有 `--*` 设计变量；深浅色用 `[data-theme='dark']`/`.theme-dark` 双写，与全文件既有约定保持一致）：

```css
/* 代码运行对话框 */
.code-runner-backdrop { display: flex; align-items: center; justify-content: center; }
.code-runner-dialog {
  width: min(680px, calc(100vw - 64px));
  max-height: min(78vh, 720px);
  display: flex; flex-direction: column;
  border-radius: 12px;
  background: var(--surface, #ffffff);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.code-runner-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.code-runner-title { display: flex; align-items: center; gap: 10px; }
.code-runner-title h2 { margin: 0; font-size: 15px; }
.code-runner-lang-badge {
  font-size: 12px; padding: 2px 8px; border-radius: 6px;
  background: var(--accent-soft, #eef3fa); color: var(--accent, #3c6ea5);
  font-family: var(--font-mono);
}
.code-runner-editor { height: 260px; min-height: 160px; overflow: hidden; border-bottom: 1px solid var(--border); }
.code-runner-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px;
}
.code-runner-cwd {
  font-size: 12px; color: var(--muted, #6b7683);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0;
}
.code-runner-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.runner-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 7px; font-size: 13px;
  border: 1px solid var(--border); background: transparent; cursor: pointer;
}
.runner-action-btn.is-run { background: #2f6f4f; border-color: #2f6f4f; color: #fff; }
.runner-action-btn.is-stop { background: #b34a4a; border-color: #b34a4a; color: #fff; }
.runner-action-btn.is-ghost { color: var(--text, #24272b); }
.code-runner-output-area {
  border-top: 1px solid var(--border);
  max-height: 240px; overflow: auto;
  background: var(--code-bg, #f6f8fa);
  padding: 0;
}
.code-runner-output-meta {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; background: var(--surface, #ffffff);
  border-bottom: 1px solid var(--border); font-size: 12px;
}
.code-runner-status.is-success { color: #2f6f4f; }
.code-runner-status.is-error, .code-runner-status.is-cancelled { color: #b34a4a; }
.code-runner-status.is-running { color: var(--accent, #3c6ea5); }
.code-runner-status.is-timeout { color: #9a6500; }
.code-runner-duration { color: var(--muted, #6b7683); }
.runner-output {
  margin: 0; padding: 10px 14px;
  font-size: 13px; line-height: 1.6;
  font-family: var(--font-mono);
  white-space: pre-wrap; word-break: break-word;
}
.runner-output-stdout { color: var(--text, #24272b); }
.runner-output-stderr { color: #b34a4a; }
.runner-output-error { color: #b34a4a; }
.runner-output-stdout.is-muted { opacity: 0.55; }
```

> 注：`var(--foo, #fallback)` 的写法对未定义变量自动回退，若 styles.css 已定义对应 tokens（含深色主题值）则直接使用 token 名，保持与现有代码一致。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
手工：深浅主题下打开代码运行对话框，校验布局、滚动、状态色。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/styles.css
git commit -m "style: 清理内嵌代码输出样式，新增代码运行对话框样式"
```

---

## Task 9: Python 中文乱码修复（RunnerService 编码）

**Files:**
- Modify: `src/main/runner-service.ts`
- Test: `tests/runner-service.test.ts`（新增用例）、`tests/logger.test.ts`（`decodeOutput` 已有）

**Interfaces:**
- Consumes: `decodeOutput`（Task 1 产出）
- Produces: `executeCode` 内部按语言注入环境变量；stdout/stderr 解码走 `decodeOutput`

- [ ] **Step 1: 新增失败测试**

`tests/runner-service.test.ts` 追加：

```ts
  describe('编码处理', () => {
    it('decodeOutput 优先 UTF-8，损坏字节在 win32 下回退 GBK', () => {
      // '你好' 的 GBK 字节
      const gbkBuffer = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
      const decoded = decodeOutput(gbkBuffer, 'win32')
      expect(decoded).toBe('你好')
      expect(decodeOutput(Buffer.from('中文 utf-8', 'utf8'), 'win32')).toBe('中文 utf-8')
      expect(decodeOutput(Buffer.from('中文 utf-8', 'utf8'), 'darwin')).toBe('中文 utf-8')
    })

    it('python 中文输出无乱码（无 python 环境则跳过）', async () => {
      const envs = await runnerService.detectEnvironments()
      if (!envs.python?.available) return // 测试机无 python 时跳过
      const pythonRunner: RunnerDefinition = {
        id: 'python',
        name: 'Python',
        language: 'python',
        extension: '.py',
        commandTemplate: 'python -u "{file}"',
        enabled: true,
      }
      const result = await runnerService.executeCode(
        { executionId: 'exec-py-zh', language: 'python', code: 'print("中文测试：你好世界")' },
        pythonRunner,
      )
      expect(result.stdout.replace(/\r\n/g, '\n')).toContain('中文测试：你好世界')
    })
  })
```

并在该测试文件顶部 import 增加：`import { decodeOutput } from '../src/main/logger'`

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/runner-service.test.ts`
Expected: FAIL——`decodeOutput is not defined`（若本机有 python，第二个用例同时暴露乱码）。

- [ ] **Step 3: 实现**

`src/main/runner-service.ts`：

```ts
/** 按语言注入的环境变量：解决 Windows 下子进程输出使用 locale 编码导致的中文乱码 */
const LANGUAGE_ENV: Record<string, NodeJS.ProcessEnv> = {
  python: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  bash: { LANG: 'C.UTF-8' },
}

function envFor(language: string): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  if (!base.LANG) base.LANG = 'C.UTF-8'
  const key = (language || '').toLowerCase().trim()
  const inject = LANGUAGE_ENV[key]
  return inject ? { ...base, ...inject } : base
}
```

`executeCode` 内：
1. `spawn(finalCommand, { shell: true, cwd, env: process.env })` → `env: envFor(runner.language || request.language)`
2. stdout/stderr 收集由字符串改为 Buffer 累积（容量上限维持 50000 不变）：

```ts
    let stdoutBytes = Buffer.alloc(0)
    let stderrBytes = Buffer.alloc(0)
    const MAX_OUTPUT = 50000
    child.stdout?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const remaining = MAX_OUTPUT - stdoutBytes.length
      if (remaining > 0) {
        stdoutBytes = Buffer.concat([stdoutBytes, chunk.slice(0, remaining)])
      }
    })
    child.stderr?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const remaining = MAX_OUTPUT - stderrBytes.length
      if (remaining > 0) {
        stderrBytes = Buffer.concat([stderrBytes, chunk.slice(0, remaining)])
      }
    })
```

3. `handleFinish` 中产出改为：

```ts
        resolve({
          executionId: request.executionId,
          stdout: decodeOutput(stdoutBytes),
          stderr: decodeOutput(stderrBytes),
          exitCode,
          durationMs,
          timedOut,
          error: timedOut
            ? `Execution timed out after ${timeoutMs}ms`
            : (processError ? processError.message : undefined),
        })
```

并同步更新 `import { decodeOutput } from './logger'`。注意：`handleFinish` 内 `stdout`/`stderr` 这两个外层 `let` 字符串变量删除或保留为空，确保无未用变量。

- [ ] **Step 4: 验证**

Run: `npx vitest run tests/runner-service.test.ts tests/logger.test.ts`
Expected: 全绿（本机无 python 时翻编码用例仍通过、python 用例跳过）。

- [ ] **Step 5: 提交**

```bash
git add src/main/runner-service.ts tests/runner-service.test.ts
git commit -m "fix: 修复子进程输出中文乱码——按语言注入编码环境变量并支持GBK回退解码"
```

---

## Task 10: Windows 下 bash 执行：Git Bash 优先、缺失时 PowerShell

**Files:**
- Modify: `src/main/runner-service.ts`
- Test: `tests/runner-service.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  export type BashResolution = { kind: 'bash' | 'powershell'; command: string }
  export function computeBashResolution(
    platform: NodeJS.Platform,
    findOnPath: (command: string) => Promise<string | undefined>,
    candidates: string[],
  ): Promise<BashResolution>
  ```

- [ ] **Step 1: 新增失败测试**

`tests/runner-service.test.ts` 追加：

```ts
  describe('win32 bash 解析', () => {
    import('node:fs').then(() => undefined) // noop；确保纯函数测试不依赖真实 fs stat
    it('win32 无 bash 时回退 PowerShell', async () => {
      const resolution = await computeBashResolution('win32', async () => undefined, [])
      expect(resolution.kind).toBe('powershell')
      expect(resolution.command).toContain('powershell')
    })

    it('win32 在 PATH 中找到 bash 时保持 bash', async () => {
      const resolution = await computeBashResolution('win32', async () => 'C:\\Git\\bin\\bash.exe', [])
      expect(resolution.kind).toBe('bash')
      expect(resolution.command).toBe('bash "{file}"')
    })

    it('非 win32 平台恒为 bash', async () => {
      const resolution = await computeBashResolution('darwin', async () => undefined, [])
      expect(resolution.kind).toBe('bash')
    })
  })
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/runner-service.test.ts`
Expected: FAIL——`computeBashResolution is not defined`

- [ ] **Step 3: 实现**

`src/main/runner-service.ts` 顶部（`COMMANDS_TO_SCAN` 之后）新增：

```ts
export type BashResolution = { kind: 'bash' | 'powershell'; command: string }

/** Windows 下 Git Bash 常见安装路径 */
const BASH_CANDIDATES_WIN32 = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Git\\bin\\bash.exe',
]

function bashCommandFor(path?: string): string {
  return path ? `"${path}" "{file}"` : 'bash "{file}"'
}

export async function computeBashResolution(
  platform: NodeJS.Platform,
  findOnPath: (command: string) => Promise<string | undefined>,
  candidates: string[],
): Promise<BashResolution> {
  if (platform !== 'win32') {
    return { kind: 'bash', command: bashCommandFor() }
  }
  const fromPath = await findOnPath('bash')
  if (fromPath) {
    return { kind: 'bash', command: bashCommandFor(fromPath) }
  }
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) {
        return { kind: 'bash', command: bashCommandFor(candidate) }
      }
    } catch { /* 继续探测下一个候选 */ }
  }
  return { kind: 'powershell', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "{file}"' }
}
```

类内新增缓存与统一入口：

```ts
  private bashResolutionCache: { resolved: Promise<BashResolution>; at: number } | null = null

  private resolveBash(): Promise<BashResolution> {
    const now = Date.now()
    if (this.bashResolutionCache && now - this.bashResolutionCache.at < 60_000) {
      return this.bashResolutionCache.resolved
    }
    const resolved = computeBashResolution(process.platform, (cmd) => this.findExecutable(cmd), BASH_CANDIDATES_WIN32)
    this.bashResolutionCache = { resolved, at: now }
    return resolved
  }
```

`executeCode` 内，在 `await mkdir(...)` 之后、`const finalCommand = ...` 之前插入平台适配：

```ts
    let targetFile = tempFilePath
    let finalCommand = runner.commandTemplate
      .replaceAll('{file}', tempFilePath)
      .replaceAll('{dir}', cwd)
      .replaceAll('{bin}', binFilePath)
    let powerShellCompatNote = ''

    const isBashRunner =
      (runner.language || '').toLowerCase() === 'bash' ||
      (request.language || '').toLowerCase() === 'bash'

    if (isBashRunner && process.platform === 'win32') {
      const resolution = await this.resolveBash()
      if (resolution.kind === 'powershell') {
        // 无 Git Bash：转写为 .ps1 由 PowerShell 兼容执行
        targetFile = path.join(this.tempDirectory, `run-${request.executionId}.ps1`)
        await writeFile(targetFile, request.code.replace(/^#![^\n]*\n/, ''), 'utf8')
        finalCommand = resolution.command
          .replaceAll('{file}', targetFile)
          .replaceAll('{dir}', cwd)
          .replaceAll('{bin}', binFilePath)
        powerShellCompatNote = '[PowerShell 兼容执行] 未检测到 Git Bash，当前脚本由 PowerShell 执行，部分 sh 语法可能不兼容。\n'
      }
    }
```

对应地：
- 原 `await writeFile(tempFilePath, request.code, 'utf8')` 保留（非 bash 分支），bash 分支经上段覆盖 `targetFile` 与写入。
- 原 `const finalCommand = ...` 两行删除（已被上面替代）。
- 输出组装时在 `handleFinish` 的 resolve 中对 stdout 前置提示：`stdout: powerShellCompatNote + decodeOutput(stdoutBytes)`。
- 清理阶段把 `tempFilePath` 的 `rm` 改为同时清理 `targetFile`（`await rm(targetFile, { force: true })`；仅增加一次 rm，兼容原行为）。

`detectEnvironments` 的 bash 路径增强（可选，紧贴需求）：保持 `findExecutable('bash')` 结果；为空时 `available:false`（设置面板据此展示「未检测到」，符合预期）。

- [ ] **Step 4: 验证**

Run: `npx vitest run tests/runner-service.test.ts`
Expected: 全绿。
手工：Windows 本机（无 Git Bash 或 Git Bash 安装均可）运行 `bash` 代码块 `echo "hello-from-bash"`，观察对话框输出：有 Git Bash → 原样执行；无 → 顶部出现 PowerShell 兼容提示且输出正常。

- [ ] **Step 5: 提交**

```bash
git add src/main/runner-service.ts tests/runner-service.test.ts
git commit -m "feat: Windows 下 bash 执行改为 Git Bash 优先、缺失时 PowerShell 兼容执行"
```

---

## Task 11: Typora 对齐——挂载输入即时渲染 + 分割线/重做快捷键

**Files:**
- Modify: `src/renderer/src/components/MarkdownEditor.tsx`（新增 `MarkdownTyping` 扩展、`redo` 命令暴露）
- Modify: `src/renderer/src/App.tsx`（快捷键 Ctrl+Shift+Z / Ctrl+Y；快捷键弹窗文案）
- Test: `tests/markdown-input-rules.test.ts`（补分割线正则用例）

**Interfaces:**
- Consumes: `createMarkdownInputRules`（现有工具函数）
- Produces: `EditorCommands.redo: () => void`

> 背景：`createMarkdownInputRules` 定义了完整「输入即渲染」规则（标题/列表/引用/任务/代码块/加粗/斜体等），但从未被编辑器挂载——本任务将其真正启用。

- [ ] **Step 1: 新增失败测试（分割线正则）**

`tests/markdown-input-rules.test.ts` 的 `rules` 数组追加：

```ts
  { name: 'HR ---', pattern: /^\s*---\s*$/, input: '---', expectedMatch: ['---'] },
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/markdown-input-rules.test.ts`
Expected: FAIL（该正则暂不存在于规则数组——为新用例编写失败预期可先断言 `rules.find(...)` 存在）——若规则数组尚未引入该行即为编译失败，即满足「红」。

- [ ] **Step 3: 挂载 MarkdownTyping 扩展**

`src/renderer/src/components/MarkdownEditor.tsx`：

import 区补充：

```ts
import { Extension } from '@tiptap/core'
import { nodeInputRule } from '@tiptap/core'
```

在模块级（`mermaid.initialize` 之后）定义：

```ts
/** Typora 风格输入即渲染：挂载已有的 markdown-input-rules */
const MarkdownTyping = Extension.create({
  name: 'markdownTyping',
  addInputRules() {
    const marks = this.editor.schema.marks
    const nodes = this.editor.schema.nodes
    return [
      ...createMarkdownInputRules(
        {
          bold: marks['bold'],
          italic: marks['italic'],
          strike: marks['strike'],
          highlight: marks['highlight'],
          code: marks['code'],
        },
        {
          heading: nodes['heading'],
          bulletList: nodes['bulletList'],
          orderedList: nodes['orderedList'],
          taskList: nodes['taskList'],
          taskItem: nodes['taskItem'],
          blockquote: nodes['blockquote'],
          codeBlock: nodes['codeBlock'],
        },
      ),
      nodeInputRule({
        find: /^\s*---\s*$/,
        type: nodes['horizontalRule'],
      }),
    ]
  },
})
```

在 `useEditor({ extensions, ...})` 的 `extensions` 数组中追加 `MarkdownTyping`（放在 `CodeBlockLowlight` 之后即可）。

`EditorCommands` 类型与 `useImperativeHandle` 中暴露重做：

```ts
  redo: () => void
```
```ts
    redo: () => editor?.chain().focus().redo().run(),
```

- [ ] **Step 4: `App.tsx` 快捷键与文案**

`handleMenuCommand` 中 `case 'edit.redo'` 保持；`keydown` 处理器中补充（放在 `if (key === 's' ...)` 之前）：

```ts
      if (key === 'z' && event.shiftKey) { event.preventDefault(); editorRef.current?.redo(); return }
      if (key === 'y' && !event.shiftKey) { event.preventDefault(); editorRef.current?.redo(); return }
```

快捷键弹窗 `shortcut-list` 追加：

```ts
                ['重做', 'Ctrl + Y / Ctrl + Shift + Z'],
```

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm run lint && npx vitest run tests/markdown-input-rules.test.ts`
手工：`npm run dev` 在编辑区输入 `# 标题`（空格触发）、`**加粗**`（末尾空格触发）、`- 列表`、`---`（识别为分割线）、`- [ ] 任务`，逐项确认即时转渲染且 Undo 可回退。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/MarkdownEditor.tsx src/renderer/src/App.tsx tests/markdown-input-rules.test.ts
git commit -m "feat: 挂载输入即渲染规则（对齐 Typora），补充分割线与重做快捷键"
```

---

## Task 12: ui-ux-pro UI 打磨

**Files:**
- Modify: `src/renderer/src/styles.css`（主要）、`src/renderer/src/components/*`（按需微调）
- Test: 无新增单测；以 typecheck + 视觉核对为准

- [ ] **Step 1: 载入 ui-ux-pro skill 并产出审查**

Run: 使用 Skill 工具载入 `ui-ux-pro`（`name: "ui-ux-pro"`），按其方法论对以下界面做审查：
- 侧栏（文件树/大纲切换、空态、选中态）
- 编辑器内容区（标题、代码块工具条、表格斑马纹、引用块、图片选中态、mermaid 卡片）
- 状态栏与顶部工具按钮
- SettingsModal（runners 卡片、模板输入、测试运行结果）
- AiPanel
- 新增 CodeRunnerDialog（与全局设计 token 对齐）
原则：增量打磨、不推倒重来；深浅色主题双向适配；对齐现有 `styles.css` 的 CSS 变量体系（如存在 `--border`/`--muted` 等 token 则优先复用）。

- [ ] **Step 2: 实施打磨**

按 ui-ux-pro 输出的高优先级改项逐项落地（典型项）：
- 统一圆角/间距/描边色：代码块工具条、runner 按钮、设置卡片对齐同一 token
- 表格增加 `tbody tr:nth-child(even)` 斑马纹与 hover 高亮
- 聚焦态：`.tiptap-editor :focus`、代码块焦点描边
- 深色主题：核对 `.code-runner-dialog`、`.runner-output-*`、对话框新增样式在深色下可读
- 状态文本（徽标/提示）对比度满足可读性

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
手工：深浅主题下逐一核对 Step 1 列出的界面，无布局回归、无对比度过低文本。

- [ ] **Step 4: 提交**

```bash
git add -A src/renderer/src
git commit -m "style: 基于 ui-ux-pro 审查统一编辑器、侧栏、设置、AI面板与运行对话框的视觉细节"
```

---

## 收尾验证

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm test`（vitest 全量）通过
- [ ] `npm run dev` 手工回归：切换文档 10+ 次无崩溃；`logs/` 有启动与操作日志；代码运行对话框编辑不改文档；Python 中文输出正常；bash 在 Windows 的两种模式均验证
- [ ] 打包验证（可选）：`npm run build` 通过，确认安装目录为 Program Files 场景日志回退 userData

## 里程碑对照（Spec → Task）

| Spec 部分 | 任务 |
|---|---|
| 一、日志基建 | Task 1、2、3 |
| 二、崩溃修复 | Task 4 |
| 三、代码运行对话框 | Task 5、6、7、8 |
| 四、Python 中文乱码 | Task 9 |
| 五、bash→PowerShell | Task 10 |
| 六、Typora 对齐 + UI | Task 11、12 |