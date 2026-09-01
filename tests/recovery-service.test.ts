import { mkdtemp, rm } from 'node:fs/promises'
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
})
