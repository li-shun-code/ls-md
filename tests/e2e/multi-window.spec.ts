import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('opening another md file via OS association adds a tab to the existing window', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-multi-'))
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-multi-ws-'))
  const fileA = path.join(workspacePath, 'a.md')
  const fileB = path.join(workspacePath, 'b.md')
  await writeFile(fileA, '# 文档 A\n\nA 的正文。', 'utf8')
  await writeFile(fileB, '# 文档 B\n\nB 的正文。', 'utf8')

  const first = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.'), fileA],
  })
  try {
    const pageA = await first.firstWindow()
    await expect(pageA.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect(pageA.locator('.tiptap-editor')).toContainText('文档 A')

    // 模拟 Windows「用墨笺打开」第二个 md 文件：第二个进程通过单实例转发给现有窗口。
    spawn(electronPath, [`--user-data-dir=${userDataPath}`, path.resolve('.'), fileB], {
      stdio: 'ignore',
    })

    // 第二个文件应成为当前窗口中的新标签页，而不是另开 BrowserWindow。
    await expect
      .poll(async () => pageA.getByRole('tab', { name: 'b.md' }).count(), { timeout: 15_000, message: '未为第二个文件创建标签页' })
      .toBe(1)
    await expect.poll(async () => first.windows().length).toBe(1)
    await expect(pageA.locator('.tiptap-editor')).toContainText('文档 B')

    await pageA.getByRole('tab', { name: 'a.md' }).click()
    await expect(pageA.locator('.tiptap-editor')).toContainText('文档 A')
    await pageA.getByRole('tab', { name: 'b.md' }).click()
    await expect(pageA.locator('.tiptap-editor')).toContainText('文档 B')
  } finally {
    await first.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  }
})
