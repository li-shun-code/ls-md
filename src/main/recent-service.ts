import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export class RecentService {
  private readonly filePath: string
  private readonly directory: string
  private readonly maxCount: number

  public constructor(userDataDirectory: string, maxCount = 20) {
    this.directory = userDataDirectory
    this.filePath = path.join(userDataDirectory, 'recent-files.json')
    this.maxCount = maxCount
  }

  public async getRecentFiles(): Promise<string[]> {
    try {
      const content = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .slice(0, this.maxCount)
      }
      return []
    } catch {
      return []
    }
  }

  public async addRecentFile(filePath: string): Promise<string[]> {
    const resolved = path.resolve(filePath)
    const current = await this.getRecentFiles()
    const updated = [resolved, ...current.filter((item) => path.resolve(item) !== resolved)].slice(0, this.maxCount)
    await this.save(updated)
    return updated
  }

  public async removeRecentFile(filePath: string): Promise<string[]> {
    const resolved = path.resolve(filePath)
    const current = await this.getRecentFiles()
    const updated = current.filter((item) => path.resolve(item) !== resolved)
    await this.save(updated)
    return updated
  }

  public async clearRecentFiles(): Promise<void> {
    await this.save([])
  }

  private async save(files: string[]): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true })
      await writeFile(this.filePath, JSON.stringify(files, null, 2), 'utf8')
    } catch (error) {
      console.error('Failed to save recent files:', error)
    }
  }
}
