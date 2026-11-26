import { _electron as electron } from 'playwright'
import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('exports visible math in HTML and PDF input', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-math-export-'))
  const htmlOutputPath = path.join(userDataPath, 'math-export.html')
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.')],
  })

  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(userDataPath, 'math.md'),
      content: '# 公式导出验收\n\n行内公式：$\\frac{1}{2} + \\alpha$。\n\n$$\\sum_{i=1}^{3} i$$',
    })
    await expect.poll(() => page.locator('.tiptap-editor [data-type="inline-math"]').evaluateAll((nodes) =>
      nodes.some((node) => node.getAttribute('data-latex') === '\\frac{1}{2} + \\alpha'),
    )).toBe(true)
    await expect(page.locator('.tiptap-editor [data-type="block-math"]')).toHaveCount(1)

    await app.evaluate(({ BrowserWindow, dialog }, outputPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: outputPath })
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportHtml')
    }, htmlOutputPath)
    await expect.poll(async () => {
      try {
        await readFile(htmlOutputPath)
        return true
      } catch {
        return false
      }
    }).toBe(true)

    const html = await readFile(htmlOutputPath, 'utf8')
    expect(await visibleFormulaCount(page, html)).toBe(2)

    await app.evaluate(({ ipcMain }, captureEnvKey) => {
      ipcMain.removeHandler('file:export-pdf')
      ipcMain.handle('file:export-pdf', async (_event, _sourcePath, exportHtml: string) => {
        process.env[captureEnvKey] = exportHtml
        return true
      })
    }, 'MATH_EXPORT_PDF_HTML')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportPdf')
    })

    await expect.poll(() => app.evaluate(() => process.env.MATH_EXPORT_PDF_HTML ?? '')).not.toBe('')
    const pdfHtml = await app.evaluate(() => process.env.MATH_EXPORT_PDF_HTML ?? '')
    expect(await visibleFormulaCount(page, pdfHtml)).toBe(2)
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})

async function visibleFormulaCount(page: Page, html: string): Promise<number> {
  return page.evaluate(async (exportHtml) => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:1200px;border:0;'
    document.body.append(frame)
    try {
      await new Promise<void>((resolve) => {
        frame.addEventListener('load', () => resolve(), { once: true })
        frame.srcdoc = exportHtml
      })
      const document = frame.contentDocument
      if (!document) return 0
      const images = Array.from(document.querySelectorAll<HTMLImageElement>('img[alt="数学公式"]'))
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)))
      return images.filter((image) => {
        const bounds = image.getBoundingClientRect()
        return image.complete && image.naturalWidth > 0 && bounds.width > 0 && bounds.height > 0
      }).length
    } finally {
      frame.remove()
    }
  }, html)
}
