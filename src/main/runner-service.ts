import { type ChildProcess, exec, execFile, spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ExecutionRequest, ExecutionResult, RunnerDefinition } from '../shared/types'

const execFileAsync = promisify(execFile)

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

  public async detectEnvironments(): Promise<Record<string, DetectedEnvironment>> {
    const results: Record<string, DetectedEnvironment> = {}

    await Promise.all(
      COMMANDS_TO_SCAN.map(async (cmd) => {
        const detected = await this.detectSingleCommand(cmd)
        results[cmd] = detected
      })
    )

    return results
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

    const finalCommand = runner.commandTemplate
      .replaceAll('{file}', tempFilePath)
      .replaceAll('{dir}', cwd)
      .replaceAll('{bin}', binFilePath)

    let child: ChildProcess
    try {
      child = spawn(finalCommand, {
        shell: true,
        cwd,
        env: process.env,
      })
    } catch (err: unknown) {
      await rm(tempFilePath, { force: true }).catch(() => {})
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

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const MAX_OUTPUT = 50000

    child.stdout?.on('data', (data: Buffer | string) => {
      const chunk = data.toString()
      if (stdout.length < MAX_OUTPUT) {
        stdout += chunk.slice(0, MAX_OUTPUT - stdout.length)
      }
    })

    child.stderr?.on('data', (data: Buffer | string) => {
      const chunk = data.toString()
      if (stderr.length < MAX_OUTPUT) {
        stderr += chunk.slice(0, MAX_OUTPUT - stderr.length)
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
          stdout,
          stderr,
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
        const { stdout } = await execFileAsync('where.exe', [command], { timeout: 3000 })
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (lines.length > 0) {
          return lines[0]
        }
      } catch {
        // Fallback to checking PATH
      }

      const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
      const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      const candidates = command.includes('.')
        ? [command]
        : [
            command,
            ...pathext.map((ext) => `${command}${ext.toLowerCase()}`),
            ...pathext.map((ext) => `${command}${ext.toUpperCase()}`),
          ]

      for (const dir of pathDirs) {
        for (const candidate of candidates) {
          const fullPath = path.join(dir, candidate)
          try {
            const s = await stat(fullPath)
            if (s.isFile()) {
              return fullPath
            }
          } catch {
            // ignore
          }
        }
      }
      return undefined
    } else {
      try {
        const { stdout } = await execFileAsync('which', [command], { timeout: 3000 })
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (lines.length > 0) {
          return lines[0]
        }
      } catch {
        // Fallback to checking PATH
      }

      const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
      for (const dir of pathDirs) {
        const fullPath = path.join(dir, command)
        try {
          const s = await stat(fullPath)
          if (s.isFile()) {
            return fullPath
          }
        } catch {
          // ignore
        }
      }
      return undefined
    }
  }

  private async detectVersion(command: string, exePath: string): Promise<string | undefined> {
    const tryVersion = async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync(exePath, args, { timeout: 2000 })
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
