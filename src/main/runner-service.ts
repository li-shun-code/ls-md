import { type ChildProcess, exec, execFile, spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ExecutionRequest, ExecutionResult, RunnerDefinition } from '../shared/types'
import { decodeOutput } from './logger'

const execFileAsync = promisify(execFile)

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

export type BashResolution = { kind: 'bash' | 'powershell'; command: string }

/** Windows 下 Git Bash 常见安装路径 */
const BASH_CANDIDATES_WIN32 = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Git\\bin\\bash.exe',
]

function bashCommandFor(bashPath?: string): string {
  return bashPath ? `"${bashPath}" "{file}"` : 'bash "{file}"'
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
    } catch {
      // 继续探测下一个候选
    }
  }
  return { kind: 'powershell', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "{file}"' }
}

export const COMMANDS_TO_SCAN = [
  'python',
  'node',
  'tsx',
  'powershell',
  'bash',
  'go',
  'rustc',
  'java',
] as const

export type CommandToScan = (typeof COMMANDS_TO_SCAN)[number]

export type DetectedEnvironment = {
  available: boolean
  path?: string
  version?: string
}

export class RunnerService {
  private readonly tempDirectory: string
  private readonly activeProcesses = new Map<string, ChildProcess>()

  public constructor(tempDirectory?: string) {
    this.tempDirectory = tempDirectory || path.join(os.tmpdir(), 'markdown-desk-runners')
  }

  public getTempDirectory(): string {
    return this.tempDirectory
  }

  private detectedEnvironmentsCache: { data: Record<string, DetectedEnvironment>; at: number } | null = null

  public async detectEnvironments(forceRefresh = false): Promise<Record<string, DetectedEnvironment>> {
    const now = Date.now()
    if (!forceRefresh && this.detectedEnvironmentsCache && now - this.detectedEnvironmentsCache.at < 300_000) {
      return this.detectedEnvironmentsCache.data
    }

    const results: Record<string, DetectedEnvironment> = {}

    await Promise.all(
      COMMANDS_TO_SCAN.map(async (cmd) => {
        const detected = await this.detectSingleCommand(cmd)
        results[cmd] = detected
      })
    )

    this.detectedEnvironmentsCache = { data: results, at: now }
    return results
  }

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

  public async executeCode(
    request: ExecutionRequest,
    runner: RunnerDefinition,
    timeoutMs = 15000
  ): Promise<ExecutionResult> {
    const startTime = Date.now()
    await mkdir(this.tempDirectory, { recursive: true })

    const ext = runner.extension
      ? runner.extension.startsWith('.')
        ? runner.extension
        : `.${runner.extension}`
      : ''
    const tempFileName = `run-${request.executionId}${ext}`
    const tempFilePath = path.join(this.tempDirectory, tempFileName)

    const binFileName = `bin-${request.executionId}${process.platform === 'win32' ? '.exe' : ''}`
    const binFilePath = path.join(this.tempDirectory, binFileName)

    await writeFile(tempFilePath, request.code, 'utf8')

    let cwd = request.workingDirectory || (request.documentPath ? path.dirname(request.documentPath) : process.cwd())
    try {
      const dirStat = await stat(cwd)
      if (!dirStat.isDirectory()) {
        cwd = process.cwd()
      }
    } catch {
      cwd = process.cwd()
    }

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
        targetFile = path.join(this.tempDirectory, `run-${request.executionId}.ps1`)
        await writeFile(targetFile, request.code.replace(/^#![^\n]*\n/, ''), 'utf8')
        finalCommand = resolution.command
          .replaceAll('{file}', targetFile)
          .replaceAll('{dir}', cwd)
          .replaceAll('{bin}', binFilePath)
        powerShellCompatNote = '[PowerShell 兼容执行] 未检测到 Git Bash，当前脚本由 PowerShell 执行，部分 sh 语法可能不兼容。\n'
      }
    }

    let child: ChildProcess
    try {
      child = spawn(finalCommand, {
        shell: true,
        cwd,
        env: envFor(runner.language || request.language),
      })
    } catch (err: unknown) {
      await rm(tempFilePath, { force: true }).catch(() => {})
      if (targetFile !== tempFilePath) {
        await rm(targetFile, { force: true }).catch(() => {})
      }
      await rm(binFilePath, { force: true }).catch(() => {})
      const message = err instanceof Error ? err.message : String(err)
      return {
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - startTime,
        timedOut: false,
        error: message,
      }
    }

    this.activeProcesses.set(request.executionId, child)

    let stdoutBytes = Buffer.alloc(0)
    let stderrBytes = Buffer.alloc(0)
    let timedOut = false
    const MAX_OUTPUT = 50000

    child.stdout?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const remaining = MAX_OUTPUT - stdoutBytes.length
      if (remaining > 0) {
        stdoutBytes = Buffer.concat([stdoutBytes, chunk.subarray(0, remaining)])
      }
    })

    child.stderr?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const remaining = MAX_OUTPUT - stderrBytes.length
      if (remaining > 0) {
        stderrBytes = Buffer.concat([stderrBytes, chunk.subarray(0, remaining)])
      }
    })

    let timeoutTimer: NodeJS.Timeout | null = null
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timeoutTimer = setTimeout(() => {
        timedOut = true
        this.killProcessTree(child)
      }, timeoutMs)
    }

    return new Promise<ExecutionResult>((resolve) => {
      let finished = false
      let processError: Error | null = null

      const handleFinish = (exitCode: number | null) => {
        if (finished) return
        finished = true

        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
        }

        const durationMs = Date.now() - startTime
        resolve({
          executionId: request.executionId,
          stdout: powerShellCompatNote + decodeOutput(stdoutBytes),
          stderr: decodeOutput(stderrBytes),
          exitCode,
          durationMs,
          timedOut,
          error: timedOut
            ? `Execution timed out after ${timeoutMs}ms`
            : (processError ? processError.message : undefined),
        })
      }

      child.on('error', (err) => {
        processError = err
        setTimeout(() => handleFinish(null), 50)
      })

      child.on('close', (code) => {
        handleFinish(code)
      })
    }).finally(async () => {
      this.activeProcesses.delete(request.executionId)
      await rm(tempFilePath, { force: true }).catch(() => {})
      if (targetFile !== tempFilePath) {
        await rm(targetFile, { force: true }).catch(() => {})
      }
      await rm(binFilePath, { force: true }).catch(() => {})
    })
  }

  public cancel(executionId: string): boolean {
    const child = this.activeProcesses.get(executionId)
    if (!child) {
      return false
    }
    this.activeProcesses.delete(executionId)
    this.killProcessTree(child)
    return true
  }

  private killProcessTree(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return

    if (process.platform === 'win32') {
      try {
        exec(`taskkill /pid ${pid} /T /F`, () => {})
      } catch {
        try {
          child.kill()
        } catch {
          // ignore
        }
      }
    } else {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }

  private async detectSingleCommand(command: string): Promise<DetectedEnvironment> {
    const exePath = await this.findExecutable(command)
    if (!exePath) {
      return { available: false }
    }

    const version = await this.detectVersion(command, exePath)
    return {
      available: true,
      path: exePath,
      ...(version ? { version } : {}),
    }
  }

  private async findExecutable(command: string): Promise<string | undefined> {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('where.exe', [command], { timeout: 1500 })
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (lines.length > 0) {
          return lines[0]
        }
      } catch {
        // where.exe 未找到或超时
      }
      return undefined
    } else {
      try {
        const { stdout } = await execFileAsync('which', [command], { timeout: 1500 })
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (lines.length > 0) {
          return lines[0]
        }
      } catch {
        // which 未找到或超时
      }
      return undefined
    }
  }

  private async detectVersion(command: string, exePath: string): Promise<string | undefined> {
    const tryVersion = async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync(exePath, args, { timeout: 1500 })
        const raw = (stdout || stderr).trim()
        if (raw) {
          const line = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
          if (line) return line
        }
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string }
        if (execErr && (execErr.stdout || execErr.stderr)) {
          const raw = (execErr.stdout || execErr.stderr || '').trim()
          if (raw) {
            const line = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
            if (line) return line
          }
        }
      }
      return undefined
    }

    // 1. Standard: <command> --version
    const version = await tryVersion(['--version'])
    if (version) return version

    // 2. PowerShell fallback
    if (command === 'powershell') {
      const psVersion = await tryVersion([
        '-NoProfile',
        '-Command',
        '$PSVersionTable.PSVersion.ToString()',
      ])
      if (psVersion) return psVersion
    }

    // 3. Go fallback
    if (command === 'go') {
      const goVersion = await tryVersion(['version'])
      if (goVersion) return goVersion
    }

    // 4. Java fallback
    if (command === 'java') {
      const javaVersion = await tryVersion(['-version'])
      if (javaVersion) return javaVersion
    }

    return undefined
  }
}
