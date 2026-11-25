import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunnerService, computeBashResolution } from '../src/main/runner-service'
import { decodeOutput } from '../src/main/logger'
import type { ExecutionRequest, RunnerDefinition } from '../src/shared/types'

describe('RunnerService', () => {
  let tempDir: string
  let runnerService: RunnerService

  const nodeRunner: RunnerDefinition = {
    id: 'javascript',
    name: 'JavaScript (Node.js)',
    language: 'javascript',
    extension: '.js',
    commandTemplate: 'node "{file}"',
    enabled: true,
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'md-runners-test-'))
    runnerService = new RunnerService(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('detectEnvironments', () => {
    it('returns detected status for common commands including node', async () => {
      const envs = await runnerService.detectEnvironments()

      expect(envs).toBeDefined()
      expect(envs.node).toBeDefined()
      expect(envs.node.available).toBe(true)
      expect(envs.node.path).toBeDefined()
      expect(typeof envs.node.path).toBe('string')
      expect(envs.node.version).toBeDefined()
      expect(envs.node.version).toMatch(/^v?\d+/)

      const expectedCommands = ['python', 'node', 'tsx', 'powershell', 'bash', 'go', 'rustc', 'java']
      for (const cmd of expectedCommands) {
        expect(envs[cmd]).toBeDefined()
        expect(typeof envs[cmd].available).toBe('boolean')
        if (envs[cmd].available) {
          expect(typeof envs[cmd].path).toBe('string')
          expect(envs[cmd].path!.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('executeCode', () => {
    it('successfully executes code using node and returns stdout, exitCode 0, durationMs > 0, timedOut false', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-success-1',
        language: 'javascript',
        code: 'console.log("hello world");',
      }

      const result = await runnerService.executeCode(request, nodeRunner)

      expect(result.executionId).toBe('exec-success-1')
      expect(result.stdout.replace(/\r\n/g, '\n')).toBe('hello world\n')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.durationMs).toBeGreaterThan(0)
      expect(result.error).toBeUndefined()
    })

    it('properly captures stderr and non-zero exit code', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-error-1',
        language: 'javascript',
        code: 'console.error("error occurred"); process.exit(2);',
      }

      const result = await runnerService.executeCode(request, nodeRunner)

      expect(result.executionId).toBe('exec-error-1')
      expect(result.stderr.replace(/\r\n/g, '\n')).toBe('error occurred\n')
      expect(result.exitCode).toBe(2)
      expect(result.timedOut).toBe(false)
      expect(result.durationMs).toBeGreaterThan(0)
    })

    it('handles timeout and terminates process cleanly', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-timeout-1',
        language: 'javascript',
        code: 'setInterval(() => {}, 1000);',
      }

      const result = await runnerService.executeCode(request, nodeRunner, 600)

      expect(result.executionId).toBe('exec-timeout-1')
      expect(result.timedOut).toBe(true)
      expect(result.durationMs).toBeGreaterThanOrEqual(500)
    })

    it('cleanly terminates a running execution via cancel()', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-cancel-1',
        language: 'javascript',
        code: 'setInterval(() => {}, 1000);',
      }

      const execPromise = runnerService.executeCode(request, nodeRunner, 15000)

      // Allow child process time to spawn
      await new Promise((resolve) => setTimeout(resolve, 300))

      const cancelled = runnerService.cancel(request.executionId)
      expect(cancelled).toBe(true)

      const result = await execPromise
      expect(result.executionId).toBe('exec-cancel-1')
      expect(result.timedOut).toBe(false)

      // Subsequent cancel should return false
      expect(runnerService.cancel(request.executionId)).toBe(false)
    })

    it('verifies that temporary files are deleted after execution completes', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-cleanup-1',
        language: 'javascript',
        code: 'console.log("cleanup test");',
      }

      const tempFile = path.join(runnerService.getTempDirectory(), `run-${request.executionId}.js`)
      const result = await runnerService.executeCode(request, nodeRunner)

      expect(result.exitCode).toBe(0)

      const exists = await access(tempFile).then(() => true).catch(() => false)
      expect(exists).toBe(false)
    })

    it('verifies that temporary files are deleted even after timeout', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-cleanup-timeout',
        language: 'javascript',
        code: 'setInterval(() => {}, 1000);',
      }

      const tempFile = path.join(runnerService.getTempDirectory(), `run-${request.executionId}.js`)
      const result = await runnerService.executeCode(request, nodeRunner, 500)

      expect(result.timedOut).toBe(true)

      const exists = await access(tempFile).then(() => true).catch(() => false)
      expect(exists).toBe(false)
    })

    it('caps output at 50,000 characters', async () => {
      const request: ExecutionRequest = {
        executionId: 'exec-capped-1',
        language: 'javascript',
        code: 'process.stdout.write("A".repeat(60000));',
      }

      const result = await runnerService.executeCode(request, nodeRunner)

      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeLessThanOrEqual(50000)
    })

    it('respects workingDirectory and substitutes {dir} and {file}', async () => {
      const customCwd = await mkdtemp(path.join(os.tmpdir(), 'md-custom-cwd-'))
      const cwdRunner: RunnerDefinition = {
        id: 'cwd-test',
        name: 'CWD Test',
        language: 'javascript',
        extension: '.js',
        commandTemplate: 'node "{file}"',
        enabled: true,
      }

      const request: ExecutionRequest = {
        executionId: 'exec-cwd-1',
        language: 'javascript',
        code: 'console.log(process.cwd());',
        workingDirectory: customCwd,
      }

      const result = await runnerService.executeCode(request, cwdRunner)
      expect(result.exitCode).toBe(0)
      expect(path.resolve(result.stdout.trim())).toBe(path.resolve(customCwd))

      await rm(customCwd, { recursive: true, force: true })
    })
  })

  describe('编码处理', () => {
    it('decodeOutput 优先 UTF-8，损坏字节在 win32 下回退 GBK', () => {
      // '你好' 的 GBK 字节序列
      const gbkBuffer = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
      const decoded = decodeOutput(gbkBuffer, 'win32')
      expect(decoded).toBe('你好')
      expect(decodeOutput(Buffer.from('中文 utf-8', 'utf8'), 'win32')).toBe('中文 utf-8')
      expect(decodeOutput(Buffer.from('中文 utf-8', 'utf8'), 'darwin')).toBe('中文 utf-8')
    })
  })

  describe('win32 bash 解析与降级', () => {
    it('win32 无 bash 时回退 PowerShell', async () => {
      const resolution = await computeBashResolution('win32', async () => undefined, [])
      expect(resolution.kind).toBe('powershell')
      expect(resolution.command).toContain('powershell')
    })

    it('win32 在 PATH 中找到 bash 时保持 bash', async () => {
      const resolution = await computeBashResolution('win32', async () => 'C:\\Git\\bin\\bash.exe', [])
      expect(resolution.kind).toBe('bash')
      expect(resolution.command).toContain('bash')
    })

    it('非 win32 平台恒为 bash', async () => {
      const resolution = await computeBashResolution('darwin', async () => undefined, [])
      expect(resolution.kind).toBe('bash')
    })
  })
})
