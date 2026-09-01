import { safeStorage, type WebContents } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AiMessage,
  AiRequest,
  AiSettings,
  AiSettingsInput,
  AiStreamEvent,
} from '../shared/types'
import { extractAiCitations, normalizeAiBaseUrl, parseAiStreamData } from './ai-utils'

type StoredAiSettings = {
  baseUrl: string
  model: string
  encryptedApiKey?: string
}

type AiEventSink = (event: AiStreamEvent) => void

const defaultSettings: StoredAiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
}

const operationInstructions: Record<AiRequest['operation'], string> = {
  qa: '回答用户关于当前 Markdown 文档的问题。只能依据提供的文档片段，引用依据时使用 [来源:doc-chunk-N]。',
  polish: '润色选中的 Markdown 内容，保持原意和 Markdown 结构，只输出改写后的内容。',
  expand: '扩写选中的 Markdown 内容，保持原有语气和 Markdown 结构，只输出改写后的内容。',
  shorten: '缩写选中的 Markdown 内容，保留关键信息和 Markdown 结构，只输出改写后的内容。',
  translate: '将选中的 Markdown 内容翻译成中文，保留 Markdown 结构，只输出翻译结果。',
  proofread: '纠错选中的 Markdown 内容中的错别字、语病和标点，只输出修正后的内容。',
  continue: '根据当前文档上下文继续写作，只输出应插入编辑器的 Markdown 内容。',
  summarize: '总结当前 Markdown 文档，按要点回答，只引用提供的文档片段。',
}

export class AiService {
  private readonly settingsPath: string
  private readonly requests = new Map<string, AbortController>()

  constructor(userDataPath: string) {
    this.settingsPath = path.join(userDataPath, 'ai-settings.json')
  }

  async getSettings(): Promise<AiSettings> {
    const settings = await this.readStoredSettings()
    return {
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKeyConfigured: Boolean(settings.encryptedApiKey),
    }
  }

  async saveSettings(input: AiSettingsInput): Promise<AiSettings> {
    const baseUrl = normalizeAiBaseUrl(input.baseUrl)
    const model = input.model.trim()
    if (!model) throw new Error('请填写 AI 模型名称')

    const current = await this.readStoredSettings()
    const next: StoredAiSettings = { ...current, baseUrl, model }
    if (input.apiKey !== undefined) {
      const apiKey = input.apiKey.trim()
      if (!apiKey) {
        delete next.encryptedApiKey
      } else {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 系统加密不可用，无法保存 API Key')
        next.encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
      }
    }

    await this.writeStoredSettings(next)
    return {
      baseUrl: next.baseUrl,
      model: next.model,
      apiKeyConfigured: Boolean(next.encryptedApiKey),
    }
  }

  async start(request: AiRequest, sender: WebContents): Promise<string> {
    if (!request.requestId || this.requests.has(request.requestId)) throw new Error('AI 请求标识无效')
    const settings = await this.readStoredSettings()
    const apiKey = this.decryptApiKey(settings.encryptedApiKey)
    if (!apiKey) throw new Error('请先在 AI 面板中配置 API Key')
    if (!settings.model) throw new Error('请先在 AI 面板中配置模型名称')

    const controller = new AbortController()
    this.requests.set(request.requestId, controller)
    const sink: AiEventSink = (event) => {
      if (!sender.isDestroyed()) sender.send('ai-stream', event)
    }
    void this.run(request, settings, apiKey, controller, sink)
    return request.requestId
  }

  async cancel(requestId: string): Promise<void> {
    this.requests.get(requestId)?.abort()
    this.requests.delete(requestId)
  }

  cancelAll(): void {
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }

  private async run(
    request: AiRequest,
    settings: StoredAiSettings,
    apiKey: string,
    controller: AbortController,
    sink: AiEventSink,
  ): Promise<void> {
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 120_000)

    try {
      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.model,
          stream: true,
          messages: this.buildMessages(request),
        }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(this.getHttpError(response.status))
      if (!response.body) throw new Error('AI 服务没有返回流式内容')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let answer = ''
      const consumeBlock = (block: string) => {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (!data) return
        const delta = parseAiStreamData(data)
        if (!delta) return
        answer += delta
        sink({ requestId: request.requestId, type: 'delta', text: delta })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        blocks.forEach(consumeBlock)
      }
      consumeBlock(buffer)

      if (controller.signal.aborted) {
        if (timedOut) sink({ requestId: request.requestId, type: 'error', message: 'AI 请求超时，请检查网络或稍后重试' })
        return
      }
      sink({ requestId: request.requestId, type: 'done', citations: extractAiCitations(answer, request.context) })
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return
      sink({ requestId: request.requestId, type: 'error', message: error instanceof Error ? error.message : 'AI 请求失败' })
    } finally {
      clearTimeout(timeout)
      this.requests.delete(request.requestId)
    }
  }

  private buildMessages(request: AiRequest): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const history: AiMessage[] = request.history.slice(-8).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }))
    const context = request.context.slice(0, 6).map((chunk) => (
      `[${chunk.id}] ${chunk.heading}（第 ${chunk.startLine}-${chunk.endLine} 行）\n${chunk.text}`
    )).join('\n\n') || '（没有检索到相关文档片段）'
    const selection = request.selection?.text ? `\n选中的内容：\n${request.selection.text}` : ''
    const prompt = [
      `当前文档：${request.documentTitle || '未命名文档'}`,
      `操作：${operationInstructions[request.operation]}`,
      `相关文档片段：\n${context}`,
      selection,
      `用户请求：${request.prompt}`,
    ].filter(Boolean).join('\n\n')

    return [
      {
        role: 'system',
        content: '你是墨笺内置 AI 助手。请明确说明这是 AI 生成内容。回答问题时不得编造文档中不存在的信息；信息不足时直接说明。编辑操作只输出结果，不要添加解释、前后引号或代码围栏。',
      },
      ...history,
      { role: 'user', content: prompt },
    ]
  }

  private async readStoredSettings(): Promise<StoredAiSettings> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredAiSettings>
      return {
        baseUrl: typeof parsed.baseUrl === 'string' ? normalizeAiBaseUrl(parsed.baseUrl) : defaultSettings.baseUrl,
        model: typeof parsed.model === 'string' ? parsed.model : defaultSettings.model,
        ...(typeof parsed.encryptedApiKey === 'string' ? { encryptedApiKey: parsed.encryptedApiKey } : {}),
      }
    } catch {
      return { ...defaultSettings }
    }
  }

  private async writeStoredSettings(settings: StoredAiSettings): Promise<void> {
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(settings), 'utf8')
    await rename(temporaryPath, this.settingsPath)
  }

  private decryptApiKey(encryptedApiKey: string | undefined): string {
    if (!encryptedApiKey) return ''
    try {
      return safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64'))
    } catch {
      throw new Error('API Key 存储已损坏，请重新配置')
    }
  }

  private getHttpError(status: number): string {
    if (status === 401 || status === 403) return 'AI 服务拒绝了请求，请检查 API Key 和权限'
    if (status === 404) return 'AI 接口地址或模型不存在，请检查 Base URL 和模型名称'
    if (status === 429) return 'AI 服务请求过于频繁，请稍后再试'
    return `AI 服务请求失败（HTTP ${status}）`
  }
}
