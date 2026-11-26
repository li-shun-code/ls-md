import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function launchTestApp(extraArgs: string[] = []) {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-e2e-'))
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.'), ...extraArgs],
  })
  return { app, userDataPath }
}

test('opens the editor shell with a blank document', async () => {
  const { app, userDataPath } = await launchTestApp()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('tab', { name: '文件' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '大纲' })).toBeVisible()
    await expect(page.locator('.tiptap-editor')).toBeVisible()
    await page.getByRole('button', { name: '隐藏侧栏' }).click()
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-closed/)
    await page.getByRole('button', { name: '显示侧栏' }).click()
    await expect(page.locator('.sidebar')).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('jumps to the selected outline heading and enhances code blocks', async () => {
  const { app, userDataPath } = await launchTestApp()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(userDataPath, 'outline-e2e.md'),
      content: '# 第一节\n\n第一段内容。\n\n```python\nprint("hello")\nreturn 1\n```\n\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n\n![示例图片](data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=)\n\n第二段内容。\n\n## 第二节\n\n第二节内容。\n\n第三段内容。\n\n第四段内容。',
    })

    await page.locator('.outline-list > [role="treeitem"]').first().getByRole('button', { name: '展开' }).click()
    await expect(page.getByRole('treeitem', { name: '第二节' })).toBeVisible()
    await expect(page.locator('.code-line-numbers span')).toHaveCount(2)
    await expect(page.locator('.code-line-numbers span').nth(0)).toHaveText('1')
    await expect(page.locator('.code-line-numbers span').nth(1)).toHaveText('2')
    await expect(page.locator('.tiptap-editor pre .hljs-built_in')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '复制代码' })).toBeVisible()
    await expect(page.locator('[data-diagram="mermaid"] svg')).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-diagram="mermaid"] svg').click()
    await expect(page.getByRole('dialog', { name: '流程图' })).toBeVisible()
    const previewStage = page.locator('.preview-stage.is-diagram')
    await expect(previewStage).toHaveAttribute('data-preview-zoom', '1')
    await previewStage.hover()
    await page.mouse.wheel(0, -600)
    await expect(previewStage).toHaveAttribute('data-preview-zoom', '1')
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Control')
    await expect(previewStage).toHaveAttribute('data-preview-zoom', '1.1')
    for (let index = 0; index < 9; index += 1) await page.getByRole('button', { name: '放大预览' }).click()
    await expect(previewStage).toHaveAttribute('data-preview-zoom', '2')
    // Verify zoom controls work and the diagram is rendered in the preview
    await expect(page.locator('.preview-diagram-svg')).toBeVisible()
    await page.getByRole('button', { name: '重置预览缩放' }).click()
    await expect(previewStage).toHaveAttribute('data-preview-zoom', '1')
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.locator('.tiptap-editor img').click()
    await expect(page.getByRole('dialog', { name: '示例图片' })).toBeVisible()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '复制代码' }).click()
    await expect(page.getByRole('button', { name: '复制代码' })).toHaveText('已复制')

    await page.getByRole('treeitem', { name: '第二节' }).click()
    await page.getByRole('treeitem', { name: '第一节' }).click()
    await page.getByRole('treeitem', { name: '第二节' }).click()
    await expect.poll(() => page.evaluate(() => {
      const selection = window.getSelection()
      return selection?.anchorNode?.parentElement?.closest('h2')?.textContent ?? ''
    })).toBe('第二节')
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('supports Typora-style shortcuts and table context actions', async () => {
  const { app, userDataPath } = await launchTestApp()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(userDataPath, 'editor-actions-e2e.md'),
      content: '准备使用快捷键\n\n| 模块 | 状态 |\n| --- | --- |\n| 编辑器 | 正常 |',
    })

    const editor = page.locator('.tiptap-editor')
    await editor.getByText('准备使用快捷键', { exact: true }).click()
    await page.keyboard.press('Control+1')
    await expect(editor.locator('h1')).toHaveText('准备使用快捷键')

    await page.locator('td').first().click({ button: 'right' })
    await expect(page.getByRole('menu', { name: '表格操作' })).toBeVisible()
    await page.getByRole('menuitem', { name: '下方插入行' }).click()
    await expect(page.locator('tbody tr')).toHaveCount(3)

    await page.locator('td').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '删除表格' }).click()
    await expect(page.locator('table')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('opens a Markdown file passed by Windows file association and remembers it', async () => {
  const documentPath = path.join(os.tmpdir(), `markdown-desk-open-${process.pid}.md`)
  await writeFile(documentPath, '# 桌面打开验证\n\n这是通过文件关联启动的文档。', 'utf8')

  const { app: firstApp, userDataPath } = await launchTestApp([documentPath])
  let app = firstApp
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.tiptap-editor h1')).toHaveText('桌面打开验证', { timeout: 15_000 })

    await expect.poll(async () => {
      return app.evaluate(({ Menu }) => {
        const appMenu = Menu.getApplicationMenu()
        const fileMenu = appMenu?.items.find((item) => item.label === '文件')
        const recentMenu = fileMenu?.submenu?.items.find((item) => item.label === '打开最近文件')
        return recentMenu?.submenu?.items.map((item) => item.label) ?? []
      })
    }).toContain(path.basename(documentPath))

    await app.close()
    app = await electron.launch({ args: [`--user-data-dir=${userDataPath}`, path.resolve('.')] })
    const reopenedPage = await app.firstWindow()
    await expect(reopenedPage.locator('.tiptap-editor h1')).toHaveText('桌面打开验证', { timeout: 15_000 })
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
    await unlink(documentPath).catch(() => undefined)
  }
})

test('navigates to linked markdown document when clicking markdown link', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-links-'))
  const docA = path.join(root, 'index.md')
  const docB = path.join(root, 'detail.md')
  await writeFile(docA, '# 首页\n\n查看 [详情页面](./detail.md)', 'utf8')
  await writeFile(docB, '# 详情内容\n\n这是详情页。', 'utf8')

  const { app, userDataPath } = await launchTestApp([docA])
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.tiptap-editor h1')).toHaveText('首页', { timeout: 15_000 })
    await page.locator('.tiptap-editor a').click()
    await expect(page.locator('.tiptap-editor h1')).toHaveText('详情内容', { timeout: 10_000 })
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})
