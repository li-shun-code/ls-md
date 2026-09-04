import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'
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
    if (directory !== primaryDirectory) {
      // fallback 分支（forceFallback 或回退后）：确保回退目录存在
      await mkdir(directory, { recursive: true }).catch(() => undefined)
      return false
    }
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
              // 优先按文件名中的日期判断（mtime 可能被覆盖写入刷新，不具代表性）
              const nameDate = Date.parse(entry.slice(LOG_FILE_PREFIX.length, entry.length - '.log'.length))
              if (Number.isNaN(nameDate)) {
                const info = await stat(fullPath)
                if (info.mtimeMs < cutoff) await rm(fullPath, { force: true })
              } else if (nameDate < cutoff) {
                await rm(fullPath, { force: true })
              }
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
        await pruneOldLogs()
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