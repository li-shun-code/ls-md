import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('exports rendered Mermaid diagrams in document HTML', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-export-e2e-'))
  const outputPath = path.join(userDataPath, 'diagram-export.html')
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.')],
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(userDataPath, 'flowchart.md'),
      content: '# Export test\n\n```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```',
    })

    await expect(page.locator('[data-diagram="mermaid"] svg')).toBeVisible({ timeout: 15_000 })
    await app.evaluate(({ BrowserWindow, dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportHtml')
    }, outputPath)

    await expect.poll(async () => {
      try {
        await readFile(outputPath)
        return true
      } catch {
        return false
      }
    }).toBe(true)

    const html = await readFile(outputPath, 'utf8')
    expect(html).toContain('<svg')
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})
