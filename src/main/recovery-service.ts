import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RecoverySnapshot } from '../shared/types'

export class RecoveryService {
  private readonly directory: string

  public constructor(userDataDirectory: string) {
    this.directory = path.join(userDataDirectory, 'recovery')
  }

  private filePath(documentPath: string): string {
    const key = createHash('sha256').update(path.resolve(documentPath)).digest('hex')
    return path.join(this.directory, `${key}.json`)
  }

  public async write(snapshot: RecoverySnapshot): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await writeFile(this.filePath(snapshot.path), JSON.stringify(snapshot), 'utf8')
  }

  public async read(documentPath: string): Promise<RecoverySnapshot | null> {
    try {
      const content = await readFile(this.filePath(documentPath), 'utf8')
      const snapshot = JSON.parse(content) as RecoverySnapshot

      // 时效性检查：如果磁盘原文件存在且已被更新（修改时间晚于快照创建时间），说明快照已过时，自动静默清除
      try {
        const fileStat = await stat(path.resolve(documentPath))
        if (fileStat.mtimeMs >= snapshot.createdAt) {
          await this.clear(documentPath)
          return null
        }
      } catch {
        // 原文件可能已被删除或暂不可达，保留快照以防数据丢失
      }

      return snapshot
    } catch {
      return null
    }
  }

  public async clear(documentPath: string): Promise<void> {
    await rm(this.filePath(documentPath), { force: true })
  }
}
