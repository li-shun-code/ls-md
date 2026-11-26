import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
      const body = JSON.parse(requestBody) as {
        stream?: boolean
        messages: Array<{ role?: string; content: string }>
      }
      if (body.stream === false) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '- 使用简洁、清晰的中文表达。' } }] }))
        return
      }
      const latestContent = body.messages.at(-1)?.content ?? ''
      const systemContent = body.messages[0]?.content ?? ''
      const isPolish = latestContent.includes('操作：润色')
      const isProofread = latestContent.includes('操作：纠错')
      const isFollowUp = latestContent.includes('我刚才问了什么')
      const hasPriorQuestion = body.messages.some((message) => message.role === 'user' && message.content.includes('当前文档讲了什么？'))
      const isSectionRewrite = latestContent.includes('请改写文档中的结论部分。')
      const isRewrite = latestContent.includes('操作：按用户要求改写当前完整 Markdown 文档')
      const includesWritingMemory = systemContent.includes('使用简洁、清晰的中文表达')
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const answer = isFollowUp && hasPriorQuestion && systemContent.includes('根据最近的会话历史回答')
        ? '你刚才问的是“当前文档讲了什么？”。'
        : isRewrite && includesWritingMemory
          ? '# 风格改写\n\n这是按偏好改写后的全文。\n\n这是只应发送给 AI 的内容。'
          : isSectionRewrite
            ? '好的，我可以只修改结论部分。'
          : isPolish
            ? '改写后的内容'
            : isProofread
              ? '纠错后的内容'
              : '## 回答\n\n这是回答。'
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`)
      if (!isPolish && !isProofread && !isFollowUp && !isRewrite) response.write('data: {"choices":[{"delta":{"content":" [来源:doc-chunk-1]"}}]}\n\n')
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const { app, userDataPath } = await launchTestApp()
  const documentPath = path.join(userDataPath, 'ai-e2e.md')
  const initialDocument = '# 当前文档\n\n这是只应发送给 AI 的内容。\n\n## 第二节\n\n更多说明。'

  try {
    await writeFile(documentPath, initialDocument, 'utf8')
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await app.evaluate(({ BrowserWindow }, document) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('document-opened', document)
    }, {
      path: documentPath,
      content: initialDocument,
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

    await input.fill('我刚才问了什么？')
    await input.press('Enter')
    await expect(page.getByText('你刚才问的是“当前文档讲了什么？”。')).toBeVisible({ timeout: 15_000 })
    const followUpBody = JSON.parse(requestBodies[1]) as { messages: Array<{ role: string; content: string }> }
    expect(followUpBody.messages[0]?.content).toContain('根据最近的会话历史回答')
    expect(followUpBody.messages.some((message) => message.role === 'user' && message.content.includes('当前文档讲了什么？'))).toBe(true)

    await page.getByRole('button', { name: 'AI 历史会话' }).click()
    await expect(page.locator('.ai-history')).toBeVisible()
    await expect(page.getByRole('button', { name: /当前文档讲了什么/ })).toBeVisible()
    await page.getByRole('button', { name: /当前文档讲了什么/ }).click()

    const body = JSON.parse(requestBodies[0]) as { messages: Array<{ content: string }> }
    expect(body.messages.at(-1)?.content).toContain('这是只应发送给 AI 的内容。')
    await page.getByRole('button', { name: /当前文档.*第 1-7 行/ }).click()
    await expect(page.locator('.tiptap-editor')).toBeFocused()

    await page.getByRole('button', { name: 'AI 模型设置' }).click()
    const settings = page.locator('.settings-modal-card')
    await settings.getByRole('tab', { name: '写作偏好' }).click()
    await expect(settings.locator('#settings-writing-sample')).toBeVisible()
    await expect(settings.getByRole('tab', { name: '写作偏好' })).toHaveAttribute('aria-selected', 'true')
    await expect(settings.getByRole('tab', { name: 'AI 助手模型' })).toHaveAttribute('aria-selected', 'false')
    await expect(settings.locator('.settings-modal-tab.is-active')).toHaveText('写作偏好')
    await settings.locator('#settings-writing-sample').fill('我喜欢自然、简洁、清楚的中文表达。')
    await settings.getByRole('button', { name: '提炼并保存偏好' }).click()
    await expect(settings.locator('#settings-writing-memory')).toHaveValue('- 使用简洁、清晰的中文表达。', { timeout: 15_000 })
    expect(await readFile(path.join(userDataPath, 'writing-memory.md'), 'utf8')).toBe('- 使用简洁、清晰的中文表达。')
    await settings.getByRole('button', { name: '取消' }).click()

    await input.fill('请改写文档中的结论部分。')
    await input.press('Enter')
    await expect(page.getByText('好的，我可以只修改结论部分。 [来源:doc-chunk-1]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('AI 修改预览')).toHaveCount(0)

    await input.fill('请按我的风格改写整篇文档。')
    await input.press('Enter')
    await expect(page.getByLabel('AI 修改预览').getByText('这是按偏好改写后的全文。')).toBeVisible({ timeout: 15_000 })
    const rewriteBody = JSON.parse(requestBodies[4]) as { messages: Array<{ role: string; content: string }> }
    expect(rewriteBody.messages[0]?.content).toContain('使用简洁、清晰的中文表达')
    expect(rewriteBody.messages.at(-1)?.content).toContain('这是只应发送给 AI 的内容。')
    await page.getByRole('button', { name: '应用修改' }).click()
    await expect(page.locator('.tiptap-editor')).toContainText('这是按偏好改写后的全文。')
    await expect.poll(async () => readFile(documentPath, 'utf8')).toContain('这是按偏好改写后的全文。')

    await page.getByRole('button', { name: '文档版本' }).click()
    const versionModal = page.getByRole('dialog', { name: '版本历史' })
    await expect(versionModal).toBeVisible()
    await expect(versionModal.getByRole('button', { name: /自动保存前/ })).toBeVisible()
    await versionModal.getByRole('button', { name: /自动保存前/ }).click()
    await versionModal.getByRole('button', { name: '恢复此版本' }).click()
    await expect(versionModal).not.toBeVisible()
    await expect.poll(async () => readFile(documentPath, 'utf8')).toBe(initialDocument)

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
