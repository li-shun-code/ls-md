import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function launchTestApp() {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-runner-e2e-'))
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.')],
  })
  return { app, userDataPath }
}

test('renders code blocks with language badges, runs code, and opens settings modal', async () => {
  const { app, userDataPath } = await launchTestApp()

  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Send a document with JavaScript and Python code blocks
    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(process.cwd(), 'runner-e2e.md'),
      content: '# 代码运行与配置测试\n\n```javascript\nconsole.log("Hello from JavaScript runner")\n```\n\n```python\nprint("Hello from Python runner")\n```',
    })

    // 1. Verify language badges
    const badges = page.locator('.code-lang-badge')
    await expect(badges).toHaveCount(2, { timeout: 10_000 })
    await expect(badges.nth(0)).toHaveText('JavaScript')
    await expect(badges.nth(1)).toHaveText('Python')

    // 2. Verify default light background styling
    const preElements = page.locator('.tiptap-editor pre')
    await expect(preElements.first()).toHaveCSS('background-color', 'rgb(246, 248, 250)')

    // 3. Click the run button on the JavaScript code block
    const runButtons = page.locator('.code-run-btn')
    await expect(runButtons).toHaveCount(2)
    await runButtons.nth(0).click()

    // 4. Verify code-block-output appears with status and stdout for JavaScript
    const jsOutput = page.locator('.code-block-output').nth(0)
    await expect(jsOutput).toBeVisible({ timeout: 15_000 })
    await expect(jsOutput.locator('.code-output-status')).toHaveText('成功 (0)', { timeout: 10_000 })
    await expect(jsOutput.locator('.code-output-stdout')).toContainText('Hello from JavaScript runner')

    // Also run the Python code block to verify Python runner execution
    await runButtons.nth(1).click()
    const pyOutput = page.locator('.code-block-output').nth(1)
    await expect(pyOutput).toBeVisible({ timeout: 15_000 })
    await expect(pyOutput.locator('.code-output-status')).toHaveText('成功 (0)', { timeout: 10_000 })
    await expect(pyOutput.locator('.code-output-stdout')).toContainText('Hello from Python runner')

    // 5. Trigger settings modal opening via toolbar button
    const settingsBtn = page.getByRole('button', { name: /首选项与设置/ })
    await expect(settingsBtn).toBeVisible()
    await settingsBtn.click()

    // Verify settings modal card and tabs
    const modal = page.locator('.settings-modal-card')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const runnersTab = modal.getByRole('tab', { name: '代码执行器' })
    const aiTab = modal.getByRole('tab', { name: 'AI 助手模型' })
    await expect(runnersTab).toBeVisible()
    await expect(aiTab).toBeVisible()
    await expect(runnersTab).toHaveAttribute('aria-selected', 'true')

    // Switch to AI tab and check content
    await aiTab.click()
    await expect(aiTab).toHaveAttribute('aria-selected', 'true')
    await expect(modal.locator('#settings-ai-model')).toBeVisible()

    // Close settings modal
    await page.locator('.settings-modal-close').click()
    await expect(modal).not.toBeVisible()

    // Reopen settings modal via Ctrl+, shortcut
    await page.keyboard.press('Control+,')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await page.locator('.settings-modal-close').click()
    await expect(modal).not.toBeVisible()
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})
