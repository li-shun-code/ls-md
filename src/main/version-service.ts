import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentSaveReason, DocumentVersion, DocumentVersionSummary } from '../shared/types'

const MAX_VERSIONS_PER_DOCUMENT = 50

type StoredDocumentVersion = DocumentVersion & { documentPath: string }

function getPreview(markdown: string): string {
  return markdown.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) ?? ''
}

export class VersionService {
  private readonly directory: string

  constructor(userDataDirectory: string) {
    this.directory = path.join(userDataDirectory, 'document-versions')
  }

  async captureBeforeWrite(documentPath: string, nextMarkdown: string, reason: DocumentSaveReason): Promise<void> {
    const resolvedPath = path.resolve(documentPath)
    let previousMarkdown: string
    try {
      previousMarkdown = await readFile(resolvedPath, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    if (previousMarkdown === nextMarkdown) return

    const createdAt = Date.now()
    const version: StoredDocumentVersion = {
      id: randomUUID(),
      documentPath: resolvedPath,
      createdAt,
      reason,
      preview: getPreview(previousMarkdown),
      markdown: previousMarkdown,
    }
    const directory = this.documentDirectory(resolvedPath)
    await mkdir(directory, { recursive: true })
    const targetPath = path.join(directory, `${version.id}.json`)
    const temporaryPath = `${targetPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(version), 'utf8')
    await rename(temporaryPath, targetPath)

    const files = (await readdir(directory)).filter((name) => name.endsWith('.json'))
    if (files.length <= MAX_VERSIONS_PER_DOCUMENT) return
    const versions = await Promise.all(files.map(async (name) => {
      try {
        const value = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as StoredDocumentVersion
        return { name, createdAt: value.createdAt }
      } catch {
        return { name, createdAt: 0 }
      }
    }))
    versions.sort((left, right) => right.createdAt - left.createdAt)
    await Promise.all(versions.slice(MAX_VERSIONS_PER_DOCUMENT).map(({ name }) => rm(path.join(directory, name), { force: true })))
  }

  async list(documentPath: string): Promise<DocumentVersionSummary[]> {
    const resolvedPath = path.resolve(documentPath)
    const directory = this.documentDirectory(resolvedPath)
    let files: string[]
    try {
      files = (await readdir(directory)).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }

    const versions = await Promise.all(files.map((name) => this.readStoredVersion(directory, name, resolvedPath)))
    return versions
      .filter((version): version is StoredDocumentVersion => Boolean(version))
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(({ id, createdAt, reason, preview }) => ({ id, createdAt, reason, preview }))
  }

  async read(documentPath: string, id: string): Promise<DocumentVersion | null> {
    if (!/^[a-f0-9-]+$/i.test(id)) return null
    const resolvedPath = path.resolve(documentPath)
    const version = await this.readStoredVersion(this.documentDirectory(resolvedPath), `${id}.json`, resolvedPath)
    if (!version) return null
    return {
      id: version.id,
      createdAt: version.createdAt,
      reason: version.reason,
      preview: version.preview,
      markdown: version.markdown,
    }
  }

  private documentDirectory(documentPath: string): string {
    const key = createHash('sha256').update(path.resolve(documentPath)).digest('hex')
    return path.join(this.directory, key)
  }

  private async readStoredVersion(
    directory: string,
    fileName: string,
    documentPath: string,
  ): Promise<StoredDocumentVersion | null> {
    try {
      const version = JSON.parse(await readFile(path.join(directory, fileName), 'utf8')) as StoredDocumentVersion
      return path.resolve(version.documentPath) === documentPath ? version : null
    } catch {
      return null
    }
  }
}
