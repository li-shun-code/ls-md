import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('opening a second md file via OS association opens a second window without disturbing the first', async () => {
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

    // 模拟 Windows「用墨笺打开」第二个 md 文件：同一用户数据目录第二次启动
    // （单实例应用下第二个进程会自行退出，通过真实子进程模拟 OS 行为）
    spawn(electronPath, [`--user-data-dir=${userDataPath}`, path.resolve('.'), fileB], {
      stdio: 'ignore',
    })

    // 等待新窗口创建并被 Playwright 附加（覆盖主进程建窗与页面注册两处异步竞态）
    await expect
      .poll(async () => first.windows().length, { timeout: 15_000, message: '未为第二个文件打开新窗口' })
      .toBe(2)
    const pageB = first.windows().find((win) => win !== pageA)
    expect(pageB, '未找到第二个窗口').toBeTruthy()
    await expect(pageB!.locator('.app-shell')).toBeVisible()
    await expect(pageB!.locator('.tiptap-editor')).toContainText('文档 B')

    // 第一个窗口保持原文档不受影响
    await expect(pageA.locator('.tiptap-editor')).toContainText('文档 A')
  } finally {
    await first.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  }
})