import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Check, Copy, History, Plus, RotateCcw, Send, Settings2, Sparkles, Square, Trash2, X } from 'lucide-react'
import type {
  AiCitation,
  AiMessage,
  AiOperation,
  AiSelection,
  AiSettings,
} from '@shared/types'
import { retrieveContext } from '@renderer/utils/ai-context'
import { renderAiMarkdown } from '@renderer/utils/ai-markdown'
import type { EditorCommands } from '@renderer/components/MarkdownEditor'

type AiPanelProps = {
  editorRef: RefObject<EditorCommands | null>
  markdown: string
  documentKey: string
  documentTitle: string
  initialAction?: { operation: AiOperation; prompt?: string; timestamp: number } | null
  onClose: () => void
  onSelectLine: (line: number) => void
  onOpenSettings?: (tab: 'ai' | 'runners') => void
}

type PanelMessage = {
  id: string
  role: AiMessage['role']
  text: string
  citations: AiCitation[]
}

type RequestState = {
  requestId: string
  operation: AiOperation
  assistantId: string
  selection: AiSelection | null
  answer: string
}

type PendingEdit = {
  operation: AiOperation
  original: string
  replacement: string
}

type AiSession = {
  id: string
  documentKey: string
  documentTitle: string
  messages: PanelMessage[]
  updatedAt: number
}

const sessionsStorageKey = 'markdown-desk-ai-sessions'

function readStoredSessions(): AiSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionsStorageKey) ?? '[]') as AiSession[]
    return Array.isArray(parsed) ? parsed.filter((session) => session && typeof session.id === 'string' && Array.isArray(session.messages)) : []
  } catch {
    return []
  }
}

const AiMarkdown = memo(function AiMarkdown({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderAiMarkdown(markdown), [markdown])
  return <div className="ai-message-content ai-message-markdown" dangerouslySetInnerHTML={{ __html: html }} />
})

const editOperations: Array<{ operation: AiOperation; label: string }> = [
  { operation: 'polish', label: '润色' },
  { operation: 'expand', label: '扩写' },
  { operation: 'shorten', label: '缩写' },
  { operation: 'translate', label: '翻译' },
  { operation: 'proofread', label: '纠错' },
]

const requiresSelection = new Set<AiOperation>(['polish', 'expand', 'shorten', 'translate', 'proofread'])

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function diffText(original: string, replacement: string): { before: string; removed: string; added: string; after: string } {
  return {
    before: '',
    removed: original,
    added: replacement,
    after: '',
  }
}

function operationLabel(operation: AiOperation): string {
  return {
    qa: '问答',
    polish: '润色',
    expand: '扩写',
    shorten: '缩写',
    translate: '翻译',
    proofread: '纠错',
    continue: '继续写作',
    summarize: '总结',
  }[operation]
}

export function AiPanel({ editorRef, markdown, documentKey, documentTitle, initialAction, onClose, onSelectLine, onOpenSettings }: AiPanelProps) {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [sessions, setSessions] = useState<AiSession[]>(readStoredSessions)
  const [sessionId, setSessionId] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null)
  const requestRef = useRef<RequestState | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const sessionsRef = useRef(sessions)

  useEffect(() => {
    sessionsRef.current = sessions
    localStorage.setItem(sessionsStorageKey, JSON.stringify(sessions.slice(0, 20)))
  }, [sessions])

  useEffect(() => {
    let active = true
    const loadSettings = () => {
      void window.desktop.getAiSettings().then((next) => {
        if (!active) return
        setSettings(next)
      }).catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : '无法读取 AI 配置')
      })
    }
    loadSettings()
    window.addEventListener('focus', loadSettings)
    return () => {
      active = false
      window.removeEventListener('focus', loadSettings)
    }
  }, [])

  useEffect(() => {
    const latest = sessionsRef.current
      .filter((session) => session.documentKey === documentKey)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    setSessionId(latest?.id ?? '')
    setMessages(latest?.messages ?? [])
    setPendingEdit(null)
    setInput('')
    setStatus('')
    setError('')
    if (requestRef.current) {
      void window.desktop.cancelAiRequest(requestRef.current.requestId)
      requestRef.current = null
    }
    setBusy(false)
  }, [documentKey])

  useEffect(() => {
    if (!sessionId) return
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? { ...session, documentTitle, messages, updatedAt: Date.now() }
        : session
    )))
  }, [documentTitle, messages, sessionId])

  useEffect(() => window.desktop.onAiStream((event) => {
    const request = requestRef.current
    if (!request || event.requestId !== request.requestId) return

    if (event.type === 'delta') {
      request.answer += event.text
      setMessages((current) => current.map((message) => (
        message.id === request.assistantId ? { ...message, text: message.text + event.text } : message
      )))
      setStatus('正在生成…')
      return
    }

    if (event.type === 'done') {
      setMessages((current) => current.map((message) => (
        message.id === request.assistantId ? { ...message, citations: event.citations } : message
      )))
      const result = request.answer
      if (request.operation !== 'qa' && request.operation !== 'summarize') {
        setPendingEdit({ operation: request.operation, original: request.selection?.text ?? '', replacement: result })
      }
      setStatus('生成完成')
      setBusy(false)
      requestRef.current = null
      return
    }

    setError(event.message)
    setStatus('生成失败')
    setBusy(false)
    requestRef.current = null
  }), [])

  useEffect(() => () => {
    if (requestRef.current) void window.desktop.cancelAiRequest(requestRef.current.requestId)
  }, [])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, [messages.length, pendingEdit])

  const hasConfiguration = Boolean(settings?.apiKeyConfigured && settings.model)
  const diff = useMemo(() => pendingEdit ? diffText(pendingEdit.original, pendingEdit.replacement) : null, [pendingEdit])
  const history = useMemo(() => sessions
    .filter((session) => session.documentKey === documentKey && session.messages.length > 0)
    .sort((left, right) => right.updatedAt - left.updatedAt), [documentKey, sessions])

  const send = async (operation: AiOperation, customPrompt?: string) => {
    if (busy) return
    const prompt = (customPrompt ?? input).trim()
    let currentConfigured = hasConfiguration
    try {
      const latest = await window.desktop.getAiSettings()
      setSettings(latest)
      currentConfigured = Boolean(latest.apiKeyConfigured && latest.model)
    } catch {
      // keep existing currentConfigured
    }

    if (!currentConfigured) {
      onOpenSettings?.('ai')
      setError('请先配置 Base URL、模型和 API Key')
      return
    }
    if (operation === 'qa' && !prompt) return

    const selection = editorRef.current?.getSelection() ?? null
    if (requiresSelection.has(operation) && !selection) {
      setError('请先在文档中选择要处理的文本')
      setStatus('纠错等编辑操作需要先选择文本')
      return
    }

    const requestId = makeId('ai')
    const assistantId = makeId('assistant')
    const contextQuery = [prompt, selection?.text].filter(Boolean).join('\n')
    const context = retrieveContext(markdown, contextQuery)
    const history: AiMessage[] = messages.map(({ role, text }) => ({ role, content: text })).filter((message) => message.content)
    const request: RequestState = { requestId, operation, assistantId, selection, answer: '' }
    const userMessage: PanelMessage = { id: makeId('user'), role: 'user', text: prompt || `请${operationLabel(operation)}`, citations: [] }
    const assistantMessage: PanelMessage = { id: assistantId, role: 'assistant', text: '', citations: [] }
    const nextSessionId = sessionId || makeId('session')
    const nextMessages = [...messages, userMessage, assistantMessage]

    setError('')
    setStatus('准备请求…')
    setMessages(nextMessages)
    setSessionId(nextSessionId)
    setSessions((current) => {
      const existing = current.find((session) => session.id === nextSessionId)
      if (existing) return current.map((session) => session.id === nextSessionId ? { ...session, messages: nextMessages, updatedAt: Date.now() } : session)
      return [{ id: nextSessionId, documentKey, documentTitle, messages: nextMessages, updatedAt: Date.now() }, ...current].slice(0, 20)
    })
    setInput('')
    requestRef.current = request
    setBusy(true)

    try {
      await window.desktop.startAiRequest({
        requestId,
        operation,
        prompt: prompt || `请${operationLabel(operation)}当前文档`,
        documentTitle,
        history,
        context,
        ...(selection ? { selection } : {}),
      })
      setStatus('正在生成…')
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '无法启动 AI 请求')
      setStatus('生成失败')
      setBusy(false)
      requestRef.current = null
    }
  }

  const stop = () => {
    const request = requestRef.current
    if (!request) return
    void window.desktop.cancelAiRequest(request.requestId)
    requestRef.current = null
    setBusy(false)
    setStatus('已停止生成')
  }

  const clearChat = () => {
    stop()
    setMessages([])
    setPendingEdit(null)
    setError('')
    setStatus('会话已清空')
  }

  const sendRef = useRef(send)
  sendRef.current = send

  const lastTriggeredActionRef = useRef<number>(0)
  useEffect(() => {
    if (!initialAction || initialAction.timestamp <= lastTriggeredActionRef.current) return
    lastTriggeredActionRef.current = initialAction.timestamp
    if (initialAction.operation === 'qa' && initialAction.prompt) {
      setInput(`请针对以下内容进行说明或回答：\n${initialAction.prompt}`)
    } else {
      void sendRef.current(initialAction.operation, initialAction.prompt)
    }
  }, [initialAction])

  const startNewSession = () => {
    stop()
    setSessionId('')
    setMessages([])
    setPendingEdit(null)
    setError('')
    setStatus('已新建会话')
    setHistoryOpen(false)
  }

  const loadSession = (session: AiSession) => {
    stop()
    setSessionId(session.id)
    setMessages(session.messages)
    setPendingEdit(null)
    setError('')
    setStatus('已切换历史会话')
    setHistoryOpen(false)
  }

  const copyMessage = async (message: PanelMessage) => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? '' : current), 1600)
    } catch {
      setError('复制失败，请检查系统剪贴板权限')
    }
  }

  const applyEdit = () => {
    if (!pendingEdit) return
    editorRef.current?.replaceSelection(pendingEdit.replacement)
    setPendingEdit(null)
    setStatus('修改已应用，可使用 Ctrl+Z 撤销')
  }

  return (
    <aside className="ai-panel" aria-label="AI 助手">
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <Sparkles size={17} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <span className="eyebrow">AI ASSISTANT</span>
            <h2>文档助手</h2>
          </div>
        </div>
        <div className="ai-panel-header-actions">
          <button type="button" className="ai-icon-button" aria-label="AI 模型设置" title="AI 模型设置" onClick={() => onOpenSettings?.('ai')}>
            <Settings2 size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" className={`ai-icon-button${historyOpen ? ' is-active' : ''}`} aria-label="AI 历史会话" title="AI 历史会话" onClick={() => setHistoryOpen((current) => !current)}>
            <History size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" className="ai-icon-button" aria-label="关闭 AI 面板" title="关闭 AI 面板" onClick={onClose}>
            <X size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      {historyOpen && (
        <section className="ai-history" aria-label="AI 历史会话">
          <div className="ai-history-heading">
            <span>本篇文档的历史会话</span>
            <button type="button" className="ai-text-button" onClick={startNewSession}><Plus size={13} strokeWidth={2} aria-hidden="true" />新建会话</button>
          </div>
          {history.length > 0 ? history.map((session) => (
            <button type="button" className={`ai-history-item${session.id === sessionId ? ' is-active' : ''}`} key={session.id} onClick={() => loadSession(session)}>
              <span>{session.messages.find((message) => message.role === 'user')?.text || session.documentTitle}</span>
              <small>{new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
            </button>
          )) : <p className="ai-history-empty">暂时没有历史会话</p>}
        </section>
      )}

      <div className="ai-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-empty-state">
            <Sparkles size={24} strokeWidth={1.5} aria-hidden="true" />
            <strong>从当前文档开始</strong>
            <p>问答只会使用当前 Markdown 文档的相关片段。</p>
            <div className="ai-quick-actions">
              <button type="button" onClick={() => void send('summarize')}>总结文档</button>
              <button type="button" onClick={() => void send('continue')}>继续写作</button>
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div className={`ai-message ai-message-${message.role}`} key={message.id}>
            <div className="ai-message-heading">
              <span className="ai-message-label">{message.role === 'user' ? '你' : 'AI 生成内容'}</span>
              {message.role === 'assistant' && message.text && <button type="button" className="ai-copy-button" aria-label="复制 AI Markdown" title="复制原始 Markdown" onClick={() => void copyMessage(message)}>{copiedMessageId === message.id ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : <Copy size={12} strokeWidth={1.8} aria-hidden="true" />}{copiedMessageId === message.id ? '已复制' : '复制 Markdown'}</button>}
            </div>
            {message.role === 'assistant' && message.text ? <AiMarkdown markdown={message.text} /> : <div className="ai-message-content">{message.text || (busy && message.role === 'assistant' ? '正在思考…' : '')}</div>}
            {message.citations.length > 0 && (
              <div className="ai-citations">
                <span className="ai-citations-title">来源</span>
                {message.citations.map((citation) => (
                  <button type="button" className="ai-citation" key={citation.id} onClick={() => onSelectLine(citation.startLine)} title={citation.snippet}>
                    <span>{citation.heading}</span>
                    <small>第 {citation.startLine}-{citation.endLine} 行</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messageEndRef} />
      </div>

      {pendingEdit && diff && (
        <section className="ai-diff-preview" aria-label="AI 修改预览">
          <div className="ai-diff-heading">
            <span>修改预览 · {operationLabel(pendingEdit.operation)}</span>
            <button type="button" className="ai-icon-button" aria-label="放弃修改" title="放弃修改" onClick={() => setPendingEdit(null)}>
              <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <div className="ai-diff-content"><span>{diff.before}</span>{diff.removed && <del>{diff.removed}</del>}{diff.added && <ins>{diff.added}</ins>}<span>{diff.after}</span></div>
          <div className="ai-diff-actions">
            <button type="button" className="ai-primary-button" onClick={applyEdit}><Check size={14} strokeWidth={2} aria-hidden="true" />应用修改</button>
            <button type="button" className="ai-text-button" onClick={() => setPendingEdit(null)}>取消</button>
          </div>
        </section>
      )}

      <div className="ai-action-row" aria-label="AI 编辑操作">
        {editOperations.map(({ operation, label }) => <button type="button" key={operation} disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void send(operation)}>{label}</button>)}
      </div>
      <div className="ai-composer">
        <textarea
          value={input}
          aria-label="询问 AI"
          placeholder="询问当前文档…"
          rows={3}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send('qa')
            }
          }}
        />
        <div className="ai-composer-footer">
          <span>{error || status || (hasConfiguration ? 'Enter 发送 · Shift + Enter 换行' : '请先配置 AI')}</span>
          <div>
            <button type="button" className="ai-icon-button" aria-label="清空会话" title="清空会话" onClick={clearChat} disabled={busy && messages.length === 0}>
              <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {busy ? (
              <button type="button" className="ai-send-button is-stop" aria-label="停止生成" title="停止生成" onClick={stop}><Square size={14} fill="currentColor" strokeWidth={1.8} aria-hidden="true" /></button>
            ) : (
              <button type="button" className="ai-send-button" aria-label="发送问题" title="发送问题" onClick={() => void send('qa')} disabled={!input.trim()}><Send size={15} strokeWidth={1.8} aria-hidden="true" /></button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
