import { _electron as electron } from 'playwright'
import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function openTab(app: Awaited<ReturnType<typeof electron.launch>>, page: Page, filePath: string, content: string) {
  await writeFile(filePath, content, 'utf8')
  await app.evaluate(({ BrowserWindow }, document) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
  }, { path: filePath, content })
  await expect(page.getByRole('tab', { name: path.basename(filePath) })).toBeVisible()
}

test('right-click tab actions close tabs on either side and all tabs', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-tab-actions-'))
  const app = await electron.launch({ args: [`--user-data-dir=${userDataPath}`, path.resolve('.')] })
  const page = await app.firstWindow()

  try {
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    const files = ['a.md', 'b.md', 'c.md'].map((name) => path.join(userDataPath, name))
    await openTab(app, page, files[0], '# 文档 A')
    await openTab(app, page, files[1], '# 文档 B')
    await openTab(app, page, files[2], '# 文档 C')
    await expect(page.getByRole('tab', { name: 'c.md' })).toBeVisible()
    await page.getByRole('tab', { name: 'c.md' }).click()
    await expect(page.locator('.tiptap-editor')).toContainText('文档 C')

    await page.getByRole('tab', { name: 'b.md' }).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: '标签页操作' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: '关闭左侧标签' }).click()
    await expect(page.getByRole('tab', { name: 'a.md' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'b.md' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'c.md' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: 'b.md' }).click({ button: 'right' })
    await page.getByRole('menu', { name: '标签页操作' }).getByRole('menuitem', { name: '关闭右侧标签' }).click()
    await expect(page.getByRole('tab', { name: 'c.md' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'b.md' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.tiptap-editor')).toContainText('文档 B')

    await page.getByRole('tab', { name: 'b.md' }).click({ button: 'right' })
    await page.getByRole('menu', { name: '标签页操作' }).getByRole('menuitem', { name: '关闭所有标签' }).click()
    await expect(page.locator('.document-tab')).toHaveCount(1)
    await expect(page.getByRole('tab', { name: '功能介绍' })).toBeVisible()
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('bulk tab close asks once before discarding multiple unsaved documents', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-tab-bulk-'))
  const app = await electron.launch({ args: [`--user-data-dir=${userDataPath}`, path.resolve('.')] })
  const page = await app.firstWindow()

  try {
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    const filePath = path.join(userDataPath, 'saved.md')
    await openTab(app, page, filePath, '# 已保存文档')

    await page.getByRole('button', { name: '新建标签页' }).click()
    await page.getByRole('button', { name: '切换到源码' }).click()
    await page.getByRole('textbox', { name: 'Markdown 源码编辑器' }).fill('第一份未保存内容')

    await page.getByRole('button', { name: '新建标签页' }).click()
    await page.getByRole('button', { name: '切换到源码' }).click()
    await page.getByRole('textbox', { name: 'Markdown 源码编辑器' }).fill('第二份未保存内容')

    const closeAllTab = page.getByRole('tab', { name: /未命名文档 2/ })
    await closeAllTab.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: '标签页操作' })
    let dialogCount = 0
    page.on('dialog', async (dialog) => {
      dialogCount += 1
      await dialog.dismiss()
    })
    await menu.getByRole('menuitem', { name: '关闭所有标签' }).click()
    await expect(page.locator('.document-tab')).toHaveCount(3)
    expect(dialogCount).toBe(1)

    page.removeAllListeners('dialog')
    page.once('dialog', async (dialog) => {
      dialogCount += 1
      await dialog.accept()
    })
    await closeAllTab.click({ button: 'right' })
    await page.getByRole('menu', { name: '标签页操作' }).getByRole('menuitem', { name: '关闭所有标签' }).click()
    await expect(page.locator('.document-tab')).toHaveCount(1)
    await expect(page.getByRole('tab', { name: '功能介绍' })).toBeVisible()
    expect(dialogCount).toBe(2)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
  }
})
