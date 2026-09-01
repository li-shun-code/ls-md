import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RecentService } from '../src/main/recent-service'

describe('recent service', () => {
  it('adds, limits to 20, deduplicates, removes, and clears recent files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-recent-'))
    const service = new RecentService(directory, 20)

    expect(await service.getRecentFiles()).toEqual([])

    // Add 25 files to check 20 limit and order (most recent first)
    for (let i = 1; i <= 25; i++) {
      await service.addRecentFile(`C:\\docs\\doc${i}.md`)
    }

    const recents = await service.getRecentFiles()
    expect(recents).toHaveLength(20)
    expect(recents[0]).toBe(path.resolve('C:\\docs\\doc25.md'))
    expect(recents[19]).toBe(path.resolve('C:\\docs\\doc6.md'))

    // Re-adding an existing file moves it to the top
    await service.addRecentFile('C:\\docs\\doc10.md')
    const updated = await service.getRecentFiles()
    expect(updated).toHaveLength(20)
    expect(updated[0]).toBe(path.resolve('C:\\docs\\doc10.md'))

    // Removing a file
    await service.removeRecentFile('C:\\docs\\doc10.md')
    const afterRemove = await service.getRecentFiles()
    expect(afterRemove).toHaveLength(19)
    expect(afterRemove[0]).toBe(path.resolve('C:\\docs\\doc25.md'))

    // Clearing all files
    await service.clearRecentFiles()
    expect(await service.getRecentFiles()).toEqual([])

    await rm(directory, { recursive: true, force: true })
  })
})
