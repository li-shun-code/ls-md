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

      nodes.push({
        name: entry.name,
        path: entryPath,
        kind: 'directory',
        children: await readDirectory(entryPath),
      })
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
