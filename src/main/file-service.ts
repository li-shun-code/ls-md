import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileNode } from '../shared/types'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkdn', '.mkd'])
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'release'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'])

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function resolveWorkspacePath(root: string, target: string): string {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('文件必须位于当前工作区内')
  }

  return resolvedTarget
}

async function readDirectory(directoryPath: string): Promise<FileNode[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.markdown-desk') {
        continue
      }

      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue
        }

        try {
          nodes.push({
            name: entry.name,
            path: entryPath,
            kind: 'directory',
            children: await readDirectory(entryPath),
          })
        } catch {
          // ignore inaccessible directory
        }
        continue
      }

      if (entry.isFile() && isMarkdownPath(entryPath)) {
        nodes.push({ name: entry.name, path: entryPath, kind: 'file' })
      }
    }

    return nodes.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1
      }

      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
  } catch {
    return []
  }
}

export async function listWorkspace(root: string): Promise<FileNode[]> {
  const resolvedRoot = path.resolve(root)
  const rootStats = await stat(resolvedRoot)
  if (!rootStats.isDirectory()) {
    throw new Error('工作区必须是文件夹')
  }

  return readDirectory(resolvedRoot)
}

export async function readMarkdown(root: string, filePath: string): Promise<string> {
  const safePath = resolveWorkspacePath(root, filePath)
  if (!isMarkdownPath(safePath)) {
    throw new Error('只支持读取 Markdown 文件')
  }

  return readFile(safePath, 'utf8')
}

export async function writeMarkdown(root: string, filePath: string, content: string): Promise<void> {
  const safePath = resolveWorkspacePath(root, filePath)
  if (!isMarkdownPath(safePath)) {
    throw new Error('只支持保存 Markdown 文件')
  }

  const temporaryPath = `${safePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, content, 'utf8')

  try {
    await rename(temporaryPath, safePath)
  } catch {
    await rm(safePath, { force: true })
    await rename(temporaryPath, safePath)
  }
}

export async function copyImageAsset(sourcePath: string, workspaceRoot: string): Promise<string> {
  const sourceStats = await stat(sourcePath)
  if (!sourceStats.isFile() || !isImagePath(sourcePath)) {
    throw new Error('只支持插入图片文件')
  }

  const assetsDirectory = path.join(path.resolve(workspaceRoot), 'assets')
  await mkdir(assetsDirectory, { recursive: true })

  const sourceName = path.basename(sourcePath)
  const sourceExtension = path.extname(sourceName)
  const sourceStem = path.basename(sourceName, sourceExtension)
  let destinationName = sourceName
  let suffix = 1

  while (true) {
    const destinationPath = path.join(assetsDirectory, destinationName)
    try {
      await stat(destinationPath)
      destinationName = `${sourceStem}-${suffix}${sourceExtension}`
      suffix += 1
    } catch {
      await copyFile(sourcePath, destinationPath)
      return path.posix.join('assets', destinationName)
    }
  }
}

export async function resolveLinkedDocument(
  baseDir: string,
  targetPath: string,
  root?: string | null
): Promise<string | null> {
  let cleanTarget = targetPath.trim().replace(/^file:\/\/\/?/i, '')
  try {
    cleanTarget = decodeURIComponent(cleanTarget)
  } catch {
    // ignore
  }

  const candidate = path.isAbsolute(cleanTarget)
    ? path.resolve(cleanTarget)
    : path.resolve(baseDir || root || '.', cleanTarget)

  try {
    const s = await stat(candidate)
    if (s.isFile()) return candidate
    if (s.isDirectory()) {
      for (const indexName of ['README.md', 'index.md', 'readme.md']) {
        const indexFile = path.join(candidate, indexName)
        try {
          if ((await stat(indexFile)).isFile()) return indexFile
        } catch { /* ignore */ }
      }
    }
  } catch {
    // candidate does not exist directly
  }

  for (const ext of ['.md', '.markdown', '.mdown']) {
    const withExt = candidate + ext
    try {
      if ((await stat(withExt)).isFile()) return withExt
    } catch { /* ignore */ }
  }

  if (root) {
    try {
      const fileName = path.basename(candidate).toLowerCase()
      const searchExts = fileName.endsWith('.md') || fileName.endsWith('.markdown')
        ? [fileName]
        : [`${fileName}.md`, `${fileName}.markdown`, fileName]

      async function findFileRecursive(dir: string, depth = 0): Promise<string | null> {
        if (depth > 6) return null
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          const full = path.join(dir, entry.name)
          if (entry.isFile()) {
            if (searchExts.includes(entry.name.toLowerCase())) {
              return full
            }
          } else if (entry.isDirectory()) {
            const found = await findFileRecursive(full, depth + 1)
            if (found) return found
          }
        }
        return null
      }

      const match = await findFileRecursive(path.resolve(root))
      if (match) return match
    } catch {
      // ignore
    }
  }

  return null
}

export async function createMarkdownFile(directoryPath: string, fileName: string): Promise<string> {
  let safeName = fileName.trim()
  if (!safeName) throw new Error('文件名不能为空')
  if (!isMarkdownPath(safeName)) safeName += '.md'
  const targetPath = path.join(path.resolve(directoryPath), safeName)
  let exists = false
  try {
    await stat(targetPath)
    exists = true
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      // file does not exist, good
    } else {
      throw err
    }
  }
  if (exists) {
    throw new Error(`文件已存在：${safeName}`)
  }
  await writeFile(targetPath, '', 'utf8')
  return targetPath
}

export async function createDirectory(directoryPath: string, folderName: string): Promise<string> {
  const safeName = folderName.trim()
  if (!safeName) throw new Error('文件夹名称不能为空')
  const targetPath = path.join(path.resolve(directoryPath), safeName)
  await mkdir(targetPath, { recursive: true })
  return targetPath
}

export async function renameNode(oldPath: string, newName: string): Promise<string> {
  const safeNewName = newName.trim()
  if (!safeNewName) throw new Error('名称不能为空')
  const resolvedOld = path.resolve(oldPath)
  const parentDir = path.dirname(resolvedOld)
  const oldStat = await stat(resolvedOld)
  const isOldMarkdown = oldStat.isFile() && isMarkdownPath(resolvedOld)
  let finalNewName = safeNewName
  if (isOldMarkdown && !isMarkdownPath(finalNewName)) {
    finalNewName += path.extname(resolvedOld) || '.md'
  }
  const resolvedNew = path.join(parentDir, finalNewName)
  if (resolvedOld.toLowerCase() !== resolvedNew.toLowerCase()) {
    let exists = false
    try {
      await stat(resolvedNew)
      exists = true
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        // target doesn't exist, proceed
      } else {
        throw err
      }
    }
    if (exists) {
      throw new Error(`同名文件或文件夹已存在：${finalNewName}`)
    }
  }
  await rename(resolvedOld, resolvedNew)
  return resolvedNew
}
