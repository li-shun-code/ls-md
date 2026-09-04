import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
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

    const files = await readdir(logDir)
    expect(files.filter((f) => f.includes('2000-01-01'))).toHaveLength(0)
    expect(files.length).toBeGreaterThanOrEqual(1)
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