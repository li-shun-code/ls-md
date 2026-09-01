import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
      return JSON.parse(content) as RecoverySnapshot
    } catch {
      return null
    }
  }

  public async clear(documentPath: string): Promise<void> {
    await rm(this.filePath(documentPath), { force: true })
  }
}
