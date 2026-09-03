import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function launchTestApp() {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-ai-e2e-'))
  const app = await electron.launch({ args: [`--user-data-dir=${userDataPath}`, path.resolve('.')] })
  return { app, userDataPath }
}

test('opens the AI panel, streams a current-document answer, and jumps to its citation', async () => {
  const requestBodies: string[] = []
  const server = createServer((request, response) => {
    let requestBody = ''
    request.on('data', (chunk) => { requestBody += String(chunk) })
    request.on('end', () => {
      requestBodies.push(requestBody)
      const body = JSON.parse(requestBody) as { messages: Array<{ content: string }> }
      const latestContent = body.messages.at(-1)?.content ?? ''
      const isPolish = latestContent.includes('操作：润色')
      const isProofread = latestContent.includes('操作：纠错')
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: isPolish ? '改写后的内容' : isProofread ? '纠错后的内容' : '## 回答\n\n这是回答。' } }] })}\n\n`)
      if (!isPolish && !isProofread) response.write('data: {"choices":[{"delta":{"content":" [来源:doc-chunk-1]"}}]}\n\n')
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const { app, userDataPath } = await launchTestApp()

  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: path.join(process.cwd(), 'ai-e2e.md'),
      content: '# 当前文档\n\n这是只应发送给 AI 的内容。\n\n## 第二节\n\n更多说明。',
    })

    await page.getByRole('button', { name: '打开 AI 面板' }).click()
    await expect(page.getByRole('complementary', { name: 'AI 助手' })).toBeVisible()
    await page.getByRole('button', { name: 'AI 模型设置' }).click()
    const modal = page.locator('.settings-modal-card')
    await expect(modal).toBeVisible()
    await modal.locator('#settings-ai-baseurl').fill(`http://127.0.0.1:${port}/v1`)
    await modal.locator('#settings-ai-model').fill('mock-model')
    await modal.locator('#settings-ai-apikey').fill('test-key')
    await modal.getByRole('button', { name: '保存设置' }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    const input = page.getByRole('textbox', { name: '询问 AI' })
    await input.fill('当前文档讲了什么？')
    await input.press('Enter')
    await expect(page.getByText('这是回答。 [来源:doc-chunk-1]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.ai-message-markdown h2')).toHaveText('回答')
    await expect(page.getByRole('button', { name: /当前文档.*第 1-7 行/ })).toBeVisible()
    await page.getByRole('button', { name: 'AI 历史会话' }).click()
    await expect(page.locator('.ai-history')).toBeVisible()
    await expect(page.getByRole('button', { name: /当前文档讲了什么/ })).toBeVisible()
    await page.getByRole('button', { name: /当前文档讲了什么/ }).click()

    const body = JSON.parse(requestBodies[0]) as { messages: Array<{ content: string }> }
    expect(body.messages.at(-1)?.content).toContain('这是只应发送给 AI 的内容。')
    await page.getByRole('button', { name: /当前文档.*第 1-7 行/ }).click()
    await expect(page.locator('.tiptap-editor')).toBeFocused()

    await page.getByRole('button', { name: '切换到源码' }).click()
    const source = page.getByRole('textbox', { name: 'Markdown 源码编辑器' })
    await expect(source).toBeVisible()
    await source.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement
      const selected = '这是只应发送给 AI 的内容。'
      const start = textarea.value.indexOf(selected)
      textarea.focus()
      textarea.setSelectionRange(start, start + selected.length)
      textarea.dispatchEvent(new Event('select', { bubbles: true }))
    })
    await page.getByRole('button', { name: '润色' }).click()
    await expect(page.getByLabel('AI 修改预览').getByText('改写后的内容')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '应用修改' }).click()
    await expect.poll(() => source.inputValue()).toContain('改写后的内容')

    await source.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement
      const selected = '改写后的内容'
      const start = textarea.value.indexOf(selected)
      textarea.focus()
      textarea.setSelectionRange(start, start + selected.length)
    })
    await page.getByRole('button', { name: '纠错' }).click()
    await expect(page.getByLabel('AI 修改预览').getByText('纠错后的内容')).toBeVisible({ timeout: 15_000 })
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
