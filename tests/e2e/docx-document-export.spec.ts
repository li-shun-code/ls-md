import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

test('exports editable Word content and embeds images, Mermaid, and formulas', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-docx-e2e-'))
  const outputPath = path.join(userDataPath, 'word-export.docx')
  const imagePath = path.join(userDataPath, 'embedded-image.png')
  const imageData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fFQAAAAASUVORK5CYII=', 'base64')
  await writeFile(imagePath, imageData)
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.')],
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(userDataPath, 'word-export.md'),
      content: `# Word 导出验收\n\nDOCX_EDITABLE_TEXT\n\n| 名称 | 内容 |\n| --- | --- |\n| 表格单元格 | 可编辑 |\n\n\`\`\`ts\nconst wordExport = true\n\`\`\`\n\n流程图：\n\n\`\`\`mermaid\ngraph TD\n  A[开始] --> B[结束]\n\`\`\`\n\n公式：$\\frac{1}{2} + \\alpha$\n\n![内嵌图片](${pathToFileURL(imagePath).href})`,
    })

    await expect(page.locator('.tiptap-editor')).toContainText('DOCX_EDITABLE_TEXT')
    await app.evaluate(({ BrowserWindow, dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportDocx')
    }, outputPath)

    await expect.poll(async () => {
      try {
        await readFile(outputPath)
        return 'created'
      } catch {
        return (await page.locator('.notice').textContent().catch(() => '')) || 'pending'
      }
    }, { timeout: 30_000 }).toBe('created')

    const archive = unzipSync(new Uint8Array(await readFile(outputPath)))
    const documentXml = strFromU8(archive['word/document.xml'])
    const media = Object.keys(archive).filter((name) => name.startsWith('word/media/'))

    expect(documentXml).toContain('DOCX_EDITABLE_TEXT')
    expect(documentXml).toContain('表格单元格')
    expect(documentXml).toContain('wordExport')
    expect(documentXml).toContain('数学公式')
    expect(media.length).toBeGreaterThanOrEqual(3)
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})
