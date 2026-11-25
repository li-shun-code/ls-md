import { app, autoUpdater } from 'electron'
import type { UpdateState } from '../shared/types'

export type UpdateServiceOptions = {
  /** 通知所有渲染窗口更新状态变化 */
  broadcast: (state: UpdateState) => void
  /** 结构化日志 */
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void
}

/**
 * 在线升级服务（仅 Windows 打包环境启用）：
 * - 更新源为 GitHub Releases（latest 稳定通道，见 package.json build.publish）
 * - 启动后静默检查；发现新版本提示用户，由用户确认后下载、再由用户确认后重启安装
 */
export class UpdateService {
  private state: UpdateState = { status: 'idle' }
  private autoCheckScheduled = false

  constructor(private readonly options: UpdateServiceOptions) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => this.setStatus({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      this.setStatus({ status: 'available', version: info.version })
      void autoUpdater.downloadUpdate().catch((error) => this.fail(error, '下载更新失败'))
    })
    autoUpdater.on('update-not-available', () => this.setStatus({ status: 'not-available' }))
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({
        status: 'downloading',
        version: this.state.version,
        percent: Math.round(progress.percent * 100) / 100,
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({ status: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (error) => this.fail(error, '检查更新失败'))
  }

  getState(): UpdateState {
    return this.state
  }

  /** 是否具备在线升级条件：已打包且为 Windows 或 macOS 平台 */
  isSupported(): boolean {
    return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')
  }

  /** 启动后延迟静默检查一次 */
  scheduleAutoCheck(delayMs = 4000): void {
    if (!this.isSupported() || this.autoCheckScheduled) return
    this.autoCheckScheduled = true
    setTimeout(() => {
      void this.check().catch(() => undefined)
    }, delayMs)
  }

  async check(): Promise<UpdateState> {
    if (!this.isSupported()) {
      this.setStatus({ status: 'unsupported' })
      return this.state
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.fail(error, '检查更新失败')
    }
    return this.state
  }

  /** 下载完成后由用户确认重启安装 */
  install(): void {
    if (this.state.status !== 'downloaded') return
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true)
    })
  }

  private setStatus(next: UpdateState): void {
    this.state = next
    this.options.broadcast(next)
  }

  private fail(error: unknown, message: string): void {
    const detail = error instanceof Error ? error.message : String(error)
    this.options.log('warn', message, { detail })
    this.setStatus({ status: 'error', error: `${message}：${detail}` })
  }
}
