import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RecoveryService } from '../src/main/recovery-service'

describe('recovery service', () => {
  it('writes, reads, and clears a recovery snapshot', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-recovery-'))
    const service = new RecoveryService(directory)
    const snapshot = { path: 'C:\\docs\\draft.md', markdown: '# 草稿', createdAt: Date.now() }

    await service.write(snapshot)
    expect(await service.read(snapshot.path)).toEqual(snapshot)

    await service.clear(snapshot.path)
    expect(await service.read(snapshot.path)).toBeNull()
    await rm(directory, { recursive: true, force: true })
  })

  it('silently ignores and clears stale recovery snapshot if disk file is newer', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-recovery-'))
    const docDir = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-doc-'))
    const docPath = path.join(docDir, 'notes.md')
    await writeFile(docPath, '# 最新已保存内容', 'utf8')

    const service = new RecoveryService(directory)
    // 模拟旧快照（创建时间早于当前文件保存时间）
    const staleSnapshot = { path: docPath, markdown: '# 旧恢复版本', createdAt: Date.now() - 10000 }
    await service.write(staleSnapshot)

    // 读取时应发现已过期，返回 null 并清除
    expect(await service.read(docPath)).toBeNull()

    // 模拟新快照（创建时间晚于当前文件修改时间）
    const freshSnapshot = { path: docPath, markdown: '# 最新未保存内容', createdAt: Date.now() + 10000 }
    await service.write(freshSnapshot)
    expect(await service.read(docPath)).toEqual(freshSnapshot)

    await rm(directory, { recursive: true, force: true })
    await rm(docDir, { recursive: true, force: true })
  })
})
