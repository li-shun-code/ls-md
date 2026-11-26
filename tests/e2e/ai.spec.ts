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

test('reads the current document through tools, remembers the conversation, and previews edits', async () => {
  const requestBodies: Array<{
    stream?: boolean
    tools?: Array<{ function?: { name?: string } }>
    messages: Array<{ role?: string; content?: string | null; tool_call_id?: string }>
  }> = []
  let toolCallIndex = 0
  const server = createServer((request, response) => {
    let requestBody = ''
    request.on('data', (chunk) => { requestBody += String(chunk) })
    request.on('end', () => {
      const body = JSON.parse(requestBody) as (typeof requestBodies)[number]
      requestBodies.push(body)
      if (body.stream === false) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '- 使用简洁、清晰的中文表达。' } }] }))
        return
      }
      const latestContent = [...body.messages].filter((message) => message.role === 'user').at(-1)?.content ?? ''
      const systemContent = body.messages[0]?.content ?? ''
      const toolCount = body.messages.filter((message) => message.role === 'tool').length
      const isPolish = latestContent.includes('操作：润色')
      const isProofread = latestContent.includes('操作：纠正选中')
      const isFollowUp = latestContent.includes('我刚才问了什么')
      const hasPriorQuestion = body.messages.some((message) => message.role === 'user' && message.content?.includes('当前文档讲了什么？'))
      const isDocumentQuestion = latestContent.includes('当前文档讲了什么？')
      const isSectionRewrite = latestContent.includes('请改写文档中的结论部分。')
      const isRewrite = latestContent.includes('请按我的风格改写整篇文档。')
      const includesWritingMemory = systemContent.includes('使用简洁、清晰的中文表达')
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const finishText = (answer: string) => {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`)
        response.end('data: [DONE]\n\n')
      }
      const callTool = (name: string, args: Record<string, unknown>) => {
        toolCallIndex += 1
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${toolCallIndex}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`)
        response.end('data: [DONE]\n\n')
      }

      if (isFollowUp && hasPriorQuestion && systemContent.includes('最近的会话历史')) {
        finishText('你刚才问的是“当前文档讲了什么？”。')
      } else if (isDocumentQuestion) {
        if (toolCount === 0) callTool('get_document_outline', {})
        else if (toolCount === 1) callTool('read_document_range', { start_line: 3, end_line: 3 })
        else finishText('## 回答\n\n这是回答。')
      } else if (isSectionRewrite) {
        if (toolCount === 0) callTool('search_document', { query: '结论' })
        else if (toolCount === 1) callTool('edit_document_range', { start_line: 11, end_line: 11, replacement: '这是按偏好改写后的结论。' })
        else finishText('我已按你的写作偏好改写结论。')
      } else if (isRewrite) {
        if (toolCount === 0) callTool('get_document_outline', {})
        else if (toolCount === 1) callTool('read_document_range', { start_line: 1, end_line: 11 })
        else if (toolCount === 2 && includesWritingMemory) callTool('edit_document_range', { start_line: 1, end_line: 11, replacement: '# 风格改写\n\n这是按偏好改写后的全文。\n\n这是只应发送给 AI 的内容。' })
        else finishText('我已根据你的写作风格改写全文。')
      } else if (isPolish) {
        finishText('改写后的内容')
      } else if (isProofread) {
        finishText('纠错后的内容')
      } else {
        finishText('## 回答\n\n这是回答。')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const { app, userDataPath } = await launchTestApp()
  const documentPath = path.join(userDataPath, 'ai-e2e.md')
  const initialDocument = '# 当前文档\n\n这是只应发送给 AI 的内容。\n\n## 第二节\n\n更多说明。\n\n## 结论\n\n原始结论。'

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
    await expect(page.getByText('这是回答。')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.ai-message-markdown h2')).toHaveText('回答')
    await expect(page.locator('.ai-citations')).toHaveCount(0)

    await input.fill('我刚才问了什么？')
    await input.press('Enter')
    await expect(page.getByText('你刚才问的是“当前文档讲了什么？”。')).toBeVisible({ timeout: 15_000 })
    const followUpBody = requestBodies.find((body) => body.messages.at(-1)?.role === 'user' && body.messages.at(-1)?.content?.includes('我刚才问了什么'))
    expect(followUpBody?.messages[0]?.content).toContain('最近的会话历史')
    expect(followUpBody?.messages.some((message) => message.role === 'user' && message.content?.includes('当前文档讲了什么？'))).toBe(true)

    await page.getByRole('button', { name: 'AI 历史会话' }).click()
    await expect(page.locator('.ai-history')).toBeVisible()
    await expect(page.getByRole('button', { name: /当前文档讲了什么/ })).toBeVisible()
    await page.getByRole('button', { name: /当前文档讲了什么/ }).click()

    const firstQuestionRequest = requestBodies.find((body) => body.messages.at(-1)?.role === 'user' && body.messages.at(-1)?.content?.includes('当前文档讲了什么？'))
    expect(firstQuestionRequest?.tools?.map((tool) => tool.function?.name)).toContain('read_document_range')
    expect(JSON.stringify(firstQuestionRequest?.messages)).not.toContain('这是只应发送给 AI 的内容。')
    expect(requestBodies.some((body) => body.messages.some((message) => message.role === 'tool' && message.content?.includes('这是只应发送给 AI 的内容。')))).toBe(true)

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
    await expect(page.getByLabel('AI 修改预览').getByText('这是按偏好改写后的结论。')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '应用修改' }).click()
    await expect(page.locator('.tiptap-editor')).toContainText('这是按偏好改写后的结论。')
    await expect.poll(async () => readFile(documentPath, 'utf8')).toContain('这是按偏好改写后的结论。')

    await input.fill('请按我的风格改写整篇文档。')
    await input.press('Enter')
    await expect(page.getByLabel('AI 修改预览').getByText('这是按偏好改写后的全文。')).toBeVisible({ timeout: 15_000 })
    const rewriteRequest = requestBodies.find((body) => body.messages.at(-1)?.role === 'user' && body.messages.at(-1)?.content?.includes('请按我的风格改写整篇文档。'))
    expect(rewriteRequest?.messages[0]?.content).toContain('使用简洁、清晰的中文表达')
    expect(JSON.stringify(rewriteRequest?.messages)).not.toContain('这是只应发送给 AI 的内容。')
    expect(requestBodies.some((body) => body.messages.some((message) => message.role === 'tool' && message.content?.includes('原始结论。')))).toBe(true)
    await page.getByRole('button', { name: '应用修改' }).click()
    await expect(page.locator('.tiptap-editor')).toContainText('这是按偏好改写后的全文。')
    await expect.poll(async () => readFile(documentPath, 'utf8')).toContain('这是按偏好改写后的全文。')

    await page.getByRole('button', { name: '文档版本' }).click()
    const versionModal = page.getByRole('dialog', { name: '版本历史' })
    await expect(versionModal).toBeVisible()
    await expect(versionModal.getByRole('button', { name: /自动保存前/ })).toHaveCount(2)
    await versionModal.getByRole('button', { name: /自动保存前/ }).last().click()
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
