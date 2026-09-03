import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkspace, readMarkdown, resolveLinkedDocument, resolveWorkspacePath, writeMarkdown } from '../src/main/file-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('file service', () => {
  it('lists markdown files before filtering out unsupported files', async () => {
    const root = await createWorkspace()
    await mkdir(path.join(root, '章节'))
    await writeFile(path.join(root, '章节', '第一章.md'), '# 第一章', 'utf8')
    await writeFile(path.join(root, 'notes.txt'), 'not markdown', 'utf8')

    const tree = await listWorkspace(root)

    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('章节')
    expect(tree[0].children?.[0].name).toBe('第一章.md')
  })

  it('rejects paths outside the selected workspace', async () => {
    const root = await createWorkspace()
    expect(() => resolveWorkspacePath(root, path.join(root, '..', 'outside.md'))).toThrow('工作区')
  })

  it('writes and reads markdown content', async () => {
    const root = await createWorkspace()
    const documentPath = path.join(root, '文档.md')
    await writeMarkdown(root, documentPath, '# 已保存')

    expect(await readMarkdown(root, documentPath)).toBe('# 已保存')
    expect(await readFile(documentPath, 'utf8')).toBe('# 已保存')
  })

  it('resolves linked documents with relative path, extension omission, and workspace fuzzy matching', async () => {
    const root = await createWorkspace()
    const docsDir = path.join(root, 'docs')
    await mkdir(docsDir)
    const archDoc = path.join(docsDir, '01_architecture.md')
    await writeFile(archDoc, '# 架构设计', 'utf8')

    // 1. 同级或相对路径带后缀
    expect(await resolveLinkedDocument(docsDir, './01_architecture.md', root)).toBe(archDoc)

    // 2. 省略 .md 后缀
    expect(await resolveLinkedDocument(docsDir, './01_architecture', root)).toBe(archDoc)

    // 3. 从根目录跨目录查找
    expect(await resolveLinkedDocument(root, 'docs/01_architecture.md', root)).toBe(archDoc)

    // 4. 工作区模糊按文件名匹配（类似于 Obsidian 自由双链引用）
    expect(await resolveLinkedDocument(root, '01_architecture.md', root)).toBe(archDoc)

    // 5. 不存在的文件返回 null
    expect(await resolveLinkedDocument(root, 'non_existent.md', root)).toBeNull()
  })
})
