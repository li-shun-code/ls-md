import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('imports a global document theme and keeps it in HTML, PDF, and Word exports', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-document-theme-'))
  const themePath = path.join(userDataPath, 'Moss Paper.css')
  const markdownPath = path.join(userDataPath, 'theme-preview.md')
  const htmlPath = path.join(userDataPath, 'theme-preview.html')
  const docxPath = path.join(userDataPath, 'theme-preview.docx')
  const themeCss = `:scope {
  color: #273b2e;
  background-color: #f2efe6;
  font-family: Georgia, serif;
  line-height: 1.8;
}
:scope h1 { color: #14532d; }
:scope blockquote { border-left: 3px solid #5c7d61; }`
  await writeFile(themePath, themeCss, 'utf8')
  await writeFile(markdownPath, '# 主题预览\n\n这段正文用于测试自定义主题。\n', 'utf8')

  const launch = () => electron.launch({ args: [`--user-data-dir=${userDataPath}`, path.resolve('.')] })
  let app = await launch()

  try {
    let page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    const nativeThemeSource = () => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
    await expect.poll(nativeThemeSource).toBe('light')
    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, { path: markdownPath, content: '# 主题预览\n\n这段正文用于测试自定义主题。\n' })

    const shellBackgroundBefore = await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).backgroundColor)
    const nativeThemeBefore = await nativeThemeSource()
    await openSettings(app)
    const themeTab = page.getByRole('tab', { name: '主题' })
    await expect(themeTab).toBeVisible()
    await themeTab.click()

    const guide = page.getByRole('heading', { name: '自定义主题规范' })
    await expect(guide).toBeVisible()
    await expect(page.getByText(/:scope/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '简洁白' })).toBeVisible()
    await expect(page.getByRole('button', { name: '纸本' })).toBeVisible()
    await expect(page.getByRole('button', { name: '暖棕' })).toBeVisible()
    await expect(page.getByRole('button', { name: '学术蓝' })).toBeVisible()
    await expect(page.getByRole('button', { name: '午夜' })).toBeVisible()
    const guidePrecedesThemes = await page.evaluate(() => {
      const guideElement = document.querySelector('.settings-theme-guide')
      const libraryElement = document.querySelector('.settings-theme-library')
      return Boolean(guideElement && libraryElement && (guideElement.compareDocumentPosition(libraryElement) & Node.DOCUMENT_POSITION_FOLLOWING))
    })
    expect(guidePrecedesThemes).toBe(true)

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, themePath)
    await page.getByRole('button', { name: '导入 CSS 主题' }).click()
    const customTheme = page.getByRole('button', { name: 'Moss Paper' })
    await expect(customTheme).toHaveAttribute('aria-pressed', 'true')

    const documentColors = await page.locator('.editor-frame').evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color, font: style.fontFamily }
    })
    expect(documentColors.background).toBe('rgb(242, 239, 230)')
    expect(documentColors.color).toBe('rgb(39, 59, 46)')
    expect(documentColors.font).toContain('Georgia')
    expect(await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(shellBackgroundBefore)
    expect(await nativeThemeSource()).toBe(nativeThemeBefore)
    const selectedThemeId = await page.evaluate(() => localStorage.getItem('markdown-desk-document-theme'))
    expect(selectedThemeId).toBeTruthy()

    await page.getByRole('button', { name: '关闭设置' }).click()
    await page.getByRole('button', { name: '切换到源码' }).click()
    await expect(page.locator('.source-editor-wrap')).toBeVisible()
    expect(await page.locator('.source-editor-wrap').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(shellBackgroundBefore)
    await page.getByRole('button', { name: '切换到所见即所得' }).click()
    await expect(page.locator('.mojian-document')).toBeVisible()
    await app.evaluate(({ dialog, BrowserWindow }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportHtml')
    }, htmlPath)
    await expect.poll(async () => {
      try {
        await readFile(htmlPath)
        return true
      } catch {
        return false
      }
    }).toBe(true)
    const html = await readFile(htmlPath, 'utf8')
    expect(html).toContain('class="mojian-document"')
    expect(html).toContain('background-color: #f2efe6')

    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('file:export-pdf')
      ipcMain.handle('file:export-pdf', async (_event, _sourcePath, exportHtml: string) => {
        process.env.MOJIAN_THEME_PDF_HTML = exportHtml
        return true
      })
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportPdf')
    })
    await expect.poll(() => app.evaluate(() => process.env.MOJIAN_THEME_PDF_HTML ?? '')).not.toBe('')
    const pdfHtml = await app.evaluate(() => process.env.MOJIAN_THEME_PDF_HTML ?? '')
    expect(pdfHtml).toContain('class="mojian-document"')
    expect(pdfHtml).toContain('background-color: #f2efe6')

    await app.evaluate(({ dialog, BrowserWindow }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'file.exportDocx')
    }, docxPath)
    await expect.poll(async () => {
      try {
        await readFile(docxPath)
        return true
      } catch {
        return false
      }
    }, { timeout: 30_000 }).toBe(true)
    const archive = unzipSync(new Uint8Array(await readFile(docxPath)))
    const documentXml = strFromU8(archive['word/document.xml']).toLowerCase()
    expect(documentXml).toContain('14532d')

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => localStorage.getItem('markdown-desk-document-theme'))).toBe(selectedThemeId)
    await expect.poll(() => page.locator('.editor-frame').evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgb(242, 239, 230)')
    expect(await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(shellBackgroundBefore)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

async function openSettings(app: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'settings.open')
  })
}
