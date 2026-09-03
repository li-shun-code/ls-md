import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type { AppSettings, ExecutionRequest, RunnerDefinition } from '@shared/types'

export type SettingsTab = 'runners' | 'ai'

export type SettingsModalProps = {
  open: boolean
  initialTab?: SettingsTab
  onClose: () => void
  onSettingsSaved?: (settings: AppSettings) => void
}

const DEFAULT_RUNNER_KEYS = [
  'python',
  'javascript',
  'typescript',
  'powershell',
  'bash',
  'go',
  'rust',
  'java',
]

const DEFAULT_TEST_SNIPPETS: Record<string, string> = {
  python: 'print("Hello from Python")',
  javascript: 'console.log("Hello from JS")',
  typescript: 'console.log("Hello from TypeScript")',
  powershell: 'Write-Output "Hello from PowerShell"',
  bash: 'echo "Hello from Bash"',
  go: 'package main\nimport "fmt"\nfunc main() {\n\tfmt.Println("Hello from Go")\n}',
  rust: 'fn main() {\n    println!("Hello from Rust");\n}',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java");\n    }\n}',
}

const RUNNER_TO_COMMAND: Record<string, string> = {
  python: 'python',
  javascript: 'node',
  typescript: 'tsx',
  powershell: 'powershell',
  bash: 'bash',
  go: 'go',
  rust: 'rustc',
  java: 'java',
}

function getDetectedStatus(
  runner: RunnerDefinition,
  envs: Record<string, { available: boolean; path?: string; version?: string }>
) {
  const cmd =
    RUNNER_TO_COMMAND[runner.id.toLowerCase()] ||
    RUNNER_TO_COMMAND[runner.language.toLowerCase()] ||
    runner.id.toLowerCase()
  const env = envs[cmd]

  if (env?.available) {
    const versionPart = env.version ? ` (${env.version})` : ''
    const pathPart = env.path || cmd
    return {
      available: true,
      label: `✅ 已就绪: ${pathPart}${versionPart}`,
      title: env.path,
    }
  }

  if (runner.detectedPath) {
    const versionPart = runner.detectedVersion ? ` (${runner.detectedVersion})` : ''
    return {
      available: true,
      label: `✅ 已就绪: ${runner.detectedPath}${versionPart}`,
      title: runner.detectedPath,
    }
  }

  return {
    available: false,
    label: '⚠️ 未检测到执行器',
    title: '未在系统 PATH 中检测到对应的执行命令，请确保已安装该环境。',
  }
}

export function SettingsModal({
  open,
  initialTab = 'runners',
  onClose,
  onSettingsSaved,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

  // Runner states
  const [runners, setRunners] = useState<Record<string, RunnerDefinition>>({})
  const [detectedEnvs, setDetectedEnvs] = useState<
    Record<string, { available: boolean; path?: string; version?: string }>
  >({})
  const [isDetecting, setIsDetecting] = useState(false)
  const [testingRunners, setTestingRunners] = useState<Record<string, boolean>>({})
  const [runnerTestResults, setRunnerTestResults] = useState<
    Record<string, { success: boolean; output: string; durationMs: number }>
  >({})

  // Add custom runner states
  const [showAddForm, setShowAddForm] = useState(false)
  const [newLangId, setNewLangId] = useState('')
  const [newName, setNewName] = useState('')
  const [newExt, setNewExt] = useState('')
  const [newTemplate, setNewTemplate] = useState('')
  const [addError, setAddError] = useState('')

  // AI states
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.openai.com/v1')
  const [aiModel, setAiModel] = useState('gpt-4o-mini')
  const [aiApiKey, setAiApiKey] = useState('')
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(
    null
  )

  // Save / General modal states
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  const handleDetectEnvironments = async () => {
    setIsDetecting(true)
    try {
      const envs = await window.desktop.detectEnvironments()
      setDetectedEnvs(envs)
    } catch (err) {
      console.error('Failed to detect environments:', err)
    } finally {
      setIsDetecting(false)
    }
  }

  useEffect(() => {
    if (!open) return

    setActiveTab(initialTab)
    setSaveStatus('')
    setAiTestResult(null)
    setShowAddForm(false)

    void (async () => {
      try {
        const [settings, aiSettings] = await Promise.all([
          window.desktop.getSettings(),
          window.desktop.getAiSettings().catch(() => null),
        ])

        if (settings?.runners) {
          setRunners(settings.runners)
        }
        if (settings?.ai) {
          setAiBaseUrl(settings.ai.baseUrl || 'https://api.openai.com/v1')
          setAiModel(settings.ai.model || 'gpt-4o-mini')
          setApiKeyConfigured(Boolean(settings.ai.apiKeyConfigured))
        }
        if (aiSettings) {
          if (aiSettings.baseUrl) setAiBaseUrl(aiSettings.baseUrl)
          if (aiSettings.model) setAiModel(aiSettings.model)
          setApiKeyConfigured(aiSettings.apiKeyConfigured)
        }

        await handleDetectEnvironments()
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    })()
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const handleToggleRunner = (runnerKey: string, enabled: boolean) => {
    setRunners((prev) => ({
      ...prev,
      [runnerKey]: {
        ...prev[runnerKey],
        enabled,
      },
    }))
  }

  const handleUpdateTemplate = (runnerKey: string, commandTemplate: string) => {
    setRunners((prev) => ({
      ...prev,
      [runnerKey]: {
        ...prev[runnerKey],
        commandTemplate,
      },
    }))
  }

  const handleDeleteRunner = (runnerKey: string) => {
    setRunners((prev) => {
      const next = { ...prev }
      delete next[runnerKey]
      return next
    })
    setRunnerTestResults((prev) => {
      const next = { ...prev }
      delete next[runnerKey]
      return next
    })
  }

  const handleTestRunner = async (runnerKey: string) => {
    const runner = runners[runnerKey]
    if (!runner) return

    setTestingRunners((prev) => ({ ...prev, [runnerKey]: true }))

    const snippet =
      DEFAULT_TEST_SNIPPETS[runner.id.toLowerCase()] ||
      DEFAULT_TEST_SNIPPETS[runner.language.toLowerCase()] ||
      (runner.extension === '.sh' || runner.language.includes('sh')
        ? 'echo "Hello from runner"'
        : 'print("Hello from runner")')

    const request: ExecutionRequest = {
      executionId: `test-${runnerKey}-${Date.now()}`,
      language: runner.language || runner.id,
      code: snippet,
    }

    try {
      const result = await window.desktop.executeCode(request)
      const success = result.exitCode === 0 && !result.error && !result.timedOut
      const output = success
        ? result.stdout.trim() || '执行成功 (无标准输出)'
        : result.stderr.trim() ||
          result.error ||
          (result.timedOut ? '执行超时 (15s)' : `异常退出 (code: ${result.exitCode})`)

      setRunnerTestResults((prev) => ({
        ...prev,
        [runnerKey]: {
          success,
          output,
          durationMs: result.durationMs,
        },
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRunnerTestResults((prev) => ({
        ...prev,
        [runnerKey]: {
          success: false,
          output: `调用失败: ${msg}`,
          durationMs: 0,
        },
      }))
    } finally {
      setTestingRunners((prev) => ({ ...prev, [runnerKey]: false }))
    }
  }

  const handleAddCustomRunner = (e: React.FormEvent) => {
    e.preventDefault()
    const id = newLangId.trim().toLowerCase()
    const name = newName.trim()
    const template = newTemplate.trim()
    let ext = newExt.trim()

    if (!id) {
      setAddError('请输入语言标识符（如 ruby, php, kotlin）')
      return
    }
    if (!name) {
      setAddError('请输入显示名称')
      return
    }
    if (!template) {
      setAddError('请输入执行命令模板（如 ruby "{file}"）')
      return
    }

    if (ext && !ext.startsWith('.')) {
      ext = `.${ext}`
    }

    setRunners((prev) => ({
      ...prev,
      [id]: {
        id,
        name,
        language: id,
        extension: ext,
        commandTemplate: template,
        enabled: true,
      },
    }))

    setNewLangId('')
    setNewName('')
    setNewExt('')
    setNewTemplate('')
    setAddError('')
    setShowAddForm(false)
  }

  const handleTestAiConnection = async () => {
    if (!aiModel.trim()) {
      setAiTestResult({ success: false, message: '请填写模型名称（例如 gpt-4o-mini）' })
      return
    }
    if (!apiKeyConfigured && !aiApiKey.trim()) {
      setAiTestResult({ success: false, message: '请先输入 API Key' })
      return
    }

    setTestingAi(true)
    setAiTestResult(null)

    const testId = `test-ai-${Date.now()}`
    let finished = false
    let unsubscribe: (() => void) | null = null

    const timeoutTimer = setTimeout(() => {
      if (!finished) {
        finished = true
        unsubscribe?.()
        window.desktop.cancelAiRequest(testId).catch(() => {})
        setAiTestResult({ success: false, message: '连接超时（15秒无响应）' })
        setTestingAi(false)
      }
    }, 15000)

    unsubscribe = window.desktop.onAiStream((event) => {
      if (event.requestId !== testId || finished) return

      if (event.type === 'delta' || event.type === 'done') {
        finished = true
        clearTimeout(timeoutTimer)
        unsubscribe?.()
        window.desktop.cancelAiRequest(testId).catch(() => {})
        setAiTestResult({ success: true, message: '连接测试成功！模型响应正常。' })
        setTestingAi(false)
      } else if (event.type === 'error') {
        finished = true
        clearTimeout(timeoutTimer)
        unsubscribe?.()
        setAiTestResult({ success: false, message: event.message || '连接失败' })
        setTestingAi(false)
      }
    })

    try {
      const saved = await window.desktop.saveAiSettings({
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim(),
        ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      })
      setApiKeyConfigured(saved.apiKeyConfigured)
      if (aiApiKey.trim()) {
        setAiApiKey('')
      }

      await window.desktop.startAiRequest({
        requestId: testId,
        operation: 'qa',
        prompt: 'ping',
        documentTitle: 'ConnectionTest',
        history: [],
        context: [],
      })
    } catch (err) {
      if (!finished) {
        finished = true
        clearTimeout(timeoutTimer)
        unsubscribe?.()
        const msg = err instanceof Error ? err.message : String(err)
        setAiTestResult({ success: false, message: `连接失败: ${msg}` })
        setTestingAi(false)
      }
    }
  }

  const handleClearApiKey = async () => {
    try {
      const saved = await window.desktop.saveAiSettings({
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim() || 'default',
        apiKey: '',
      })
      setApiKeyConfigured(saved.apiKeyConfigured)
      setAiApiKey('')
      setAiTestResult({ success: true, message: 'API Key 已从安全凭据存储中清除' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAiTestResult({ success: false, message: `清除失败: ${msg}` })
    }
  }

  const handleSaveSettings = async () => {
    setIsSaving(true)
    setSaveStatus('')
    try {
      let currentApiKeyConfigured = apiKeyConfigured
      if (aiApiKey.trim()) {
        const savedAi = await window.desktop.saveAiSettings({
          baseUrl: aiBaseUrl.trim(),
          model: aiModel.trim(),
          apiKey: aiApiKey.trim(),
        })
        currentApiKeyConfigured = savedAi.apiKeyConfigured
        setApiKeyConfigured(currentApiKeyConfigured)
        setAiApiKey('')
      } else if (aiBaseUrl.trim() || aiModel.trim()) {
        await window.desktop
          .saveAiSettings({
            baseUrl: aiBaseUrl.trim(),
            model: aiModel.trim(),
          })
          .catch(() => {})
      }

      const updated = await window.desktop.updateSettings({
        runners,
        ai: {
          baseUrl: aiBaseUrl.trim(),
          model: aiModel.trim(),
          apiKeyConfigured: currentApiKeyConfigured,
        },
      })

      setSaveStatus('设置已成功保存！')
      onSettingsSaved?.(updated)
      setTimeout(() => {
        onClose()
      }, 400)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSaveStatus(`保存失败: ${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="settings-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="settings-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div className="settings-modal-title" id="settings-modal-title">
            <Settings size={18} strokeWidth={2} aria-hidden="true" />
            <span>设置</span>
          </div>
          <button
            type="button"
            className="settings-modal-close"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'runners'}
            className={`settings-modal-tab${activeTab === 'runners' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('runners')}
          >
            <Terminal size={15} strokeWidth={2} aria-hidden="true" />
            <span>代码执行器</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ai'}
            className={`settings-modal-tab${activeTab === 'ai' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            <Sparkles size={15} strokeWidth={2} aria-hidden="true" />
            <span>AI 助手模型</span>
          </button>
        </div>

        <div className="settings-modal-body">
          {activeTab === 'runners' && (
            <div className="settings-runners-tab">
              <div className="settings-runners-toolbar">
                <p className="settings-section-desc">
                  支持直接在 Markdown 编辑器中运行代码块。系统会自动检测已安装的语言运行环境。
                </p>
                <div className="settings-runners-toolbar-actions">
                  <button
                    type="button"
                    className="settings-modal-btn settings-detect-btn"
                    onClick={() => void handleDetectEnvironments()}
                    disabled={isDetecting}
                  >
                    <RefreshCw
                      size={14}
                      className={isDetecting ? 'settings-spin' : ''}
                      aria-hidden="true"
                    />
                    <span>{isDetecting ? '正在检测环境…' : '从系统 PATH 自动检测'}</span>
                  </button>
                  <button
                    type="button"
                    className="settings-modal-btn settings-add-btn"
                    onClick={() => setShowAddForm((v) => !v)}
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>添加自定义执行器</span>
                  </button>
                </div>
              </div>

              {showAddForm && (
                <form className="settings-add-runner-form" onSubmit={handleAddCustomRunner}>
                  <div className="settings-add-runner-title">添加自定义执行器</div>
                  {addError && <div className="settings-form-error">{addError}</div>}
                  <div className="settings-form-grid">
                    <label>
                      <span>语言标识 (ID) *</span>
                      <input
                        type="text"
                        placeholder="例如 ruby, php, kotlin"
                        value={newLangId}
                        onChange={(e) => setNewLangId(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span>显示名称 *</span>
                      <input
                        type="text"
                        placeholder="例如 Ruby, Kotlin"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span>文件扩展名</span>
                      <input
                        type="text"
                        placeholder=".rb, .php (可选)"
                        value={newExt}
                        onChange={(e) => setNewExt(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>执行命令模板 *</span>
                      <input
                        type="text"
                        placeholder='例如 ruby "{file}"'
                        value={newTemplate}
                        onChange={(e) => setNewTemplate(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  <p className="settings-hint">
                    可用变量：<code>&#123;file&#125;</code> 源码文件路径，<code>&#123;dir&#125;</code>{' '}
                    工作目录，<code>&#123;bin&#125;</code> 编译产物路径
                  </p>
                  <div className="settings-form-actions">
                    <button type="submit" className="settings-modal-btn is-primary">
                      添加
                    </button>
                    <button
                      type="button"
                      className="settings-modal-btn"
                      onClick={() => setShowAddForm(false)}
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}

              <div className="settings-runners-list">
                {Object.entries(runners).map(([runnerKey, runner]) => {
                  const status = getDetectedStatus(runner, detectedEnvs)
                  const isTesting = Boolean(testingRunners[runnerKey])
                  const testResult = runnerTestResults[runnerKey]
                  const isDefaultRunner = DEFAULT_RUNNER_KEYS.includes(runnerKey)

                  return (
                    <div
                      key={runnerKey}
                      className={`settings-runner-card${!runner.enabled ? ' is-disabled' : ''}`}
                    >
                      <div className="settings-runner-header">
                        <div className="settings-runner-info">
                          <div className="settings-runner-title-line">
                            <strong className="settings-runner-name">{runner.name}</strong>
                            <span className="settings-runner-lang-tag">
                              {runner.language} {runner.extension ? `(${runner.extension})` : ''}
                            </span>
                          </div>
                          <span
                            className={`settings-runner-badge ${status.available ? 'is-ready' : 'is-missing'}`}
                            title={status.title}
                          >
                            {status.label}
                          </span>
                        </div>
                        <div className="settings-runner-controls">
                          <label
                            className="settings-switch"
                            title={runner.enabled ? '已启用执行器' : '已停用执行器'}
                          >
                            <input
                              type="checkbox"
                              checked={runner.enabled}
                              onChange={(e) => handleToggleRunner(runnerKey, e.target.checked)}
                            />
                            <span className="settings-switch-slider" />
                          </label>
                        </div>
                      </div>

                      <div className="settings-runner-template-row">
                        <label className="settings-template-label">
                          <span>命令模板:</span>
                          <input
                            type="text"
                            className="settings-template-input"
                            value={runner.commandTemplate}
                            onChange={(e) => handleUpdateTemplate(runnerKey, e.target.value)}
                            placeholder='例如 python -u "{file}"'
                            spellCheck={false}
                          />
                        </label>
                      </div>

                      <div className="settings-runner-actions">
                        <div className="settings-runner-action-buttons">
                          <button
                            type="button"
                            className="settings-test-run-btn"
                            onClick={() => void handleTestRunner(runnerKey)}
                            disabled={isTesting}
                            title="使用内置示例测试执行器配置"
                          >
                            {isTesting ? (
                              <Loader2 size={13} className="settings-spin" aria-hidden="true" />
                            ) : (
                              <Play size={13} aria-hidden="true" />
                            )}
                            <span>{isTesting ? '正在测试…' : '测试运行'}</span>
                          </button>
                          {!isDefaultRunner && (
                            <button
                              type="button"
                              className="settings-delete-runner-btn"
                              onClick={() => handleDeleteRunner(runnerKey)}
                              title="删除此自定义执行器"
                            >
                              <Trash2 size={13} aria-hidden="true" />
                              <span>删除</span>
                            </button>
                          )}
                        </div>

                        {testResult && (
                          <div
                            className={`settings-runner-test-output ${testResult.success ? 'is-success' : 'is-error'}`}
                          >
                            <span className="settings-test-indicator">
                              {testResult.success ? (
                                <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                              ) : (
                                <AlertTriangle size={13} strokeWidth={2.5} aria-hidden="true" />
                              )}
                            </span>
                            <span className="settings-test-meta">
                              {testResult.success
                                ? `执行成功 (${testResult.durationMs}ms): `
                                : `执行失败 (${testResult.durationMs}ms): `}
                            </span>
                            <span className="settings-test-text" title={testResult.output}>
                              {testResult.output}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="settings-ai-form">
              <p className="settings-section-desc">
                配置兼容 OpenAI 规范的 API 接口，支持 DeepSeek、OpenAI、Kimi
                (Moonshot)、通义千问等模型服务。
              </p>

              <div className="settings-ai-field">
                <label htmlFor="settings-ai-baseurl">
                  <span>API 端点 (Base URL)</span>
                </label>
                <input
                  id="settings-ai-baseurl"
                  type="url"
                  className="settings-input"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                />
                <span className="settings-hint">
                  例如 https://api.deepseek.com/v1 或 https://api.openai.com/v1
                </span>
              </div>

              <div className="settings-ai-field">
                <label htmlFor="settings-ai-model">
                  <span>模型名称 (Model)</span>
                </label>
                <input
                  id="settings-ai-model"
                  type="text"
                  className="settings-input"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="例如 deepseek-chat 或 gpt-4o-mini"
                  spellCheck={false}
                />
                <span className="settings-hint">服务商提供的模型标识符</span>
              </div>

              <div className="settings-ai-field">
                <div className="settings-field-header">
                  <label htmlFor="settings-ai-apikey">
                    <span>API Key</span>
                  </label>
                  {apiKeyConfigured && (
                    <span className="settings-key-badge">
                      <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                      <span>已安全存储</span>
                    </span>
                  )}
                </div>
                <div className="settings-input-with-actions">
                  <input
                    id="settings-ai-apikey"
                    type={showApiKey ? 'text' : 'password'}
                    className="settings-input"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={
                      apiKeyConfigured ? '已加密保存，留空保持不变' : '输入 API Key (如 sk-...)'
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="settings-input-action-btn"
                    onClick={() => setShowApiKey((v) => !v)}
                    title={showApiKey ? '隐藏密钥' : '显示密钥'}
                  >
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div className="settings-field-sub-actions">
                  <span className="settings-hint">
                    密钥由 Windows DPAPI 系统底层加密安全存储，不会以明文保存。
                  </span>
                  {apiKeyConfigured && (
                    <button
                      type="button"
                      className="settings-text-btn is-danger"
                      onClick={() => void handleClearApiKey()}
                    >
                      清除已存密钥
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-ai-test-section">
                <button
                  type="button"
                  className="settings-modal-btn settings-test-ai-btn"
                  onClick={() => void handleTestAiConnection()}
                  disabled={testingAi}
                >
                  {testingAi ? (
                    <Loader2 size={14} className="settings-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles size={14} aria-hidden="true" />
                  )}
                  <span>{testingAi ? '正在测试连接…' : '测试连接'}</span>
                </button>

                {aiTestResult && (
                  <div
                    className={`settings-ai-test-result ${aiTestResult.success ? 'is-success' : 'is-error'}`}
                  >
                    {aiTestResult.success ? (
                      <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span>{aiTestResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="settings-modal-footer">
          <div className="settings-modal-status">
            {saveStatus && <span className="settings-save-status">{saveStatus}</span>}
          </div>
          <div className="settings-modal-footer-actions">
            <button
              type="button"
              className="settings-modal-btn"
              onClick={onClose}
              disabled={isSaving}
            >
              取消
            </button>
            <button
              type="button"
              className="settings-modal-btn is-primary"
              onClick={() => void handleSaveSettings()}
              disabled={isSaving}
            >
              {isSaving ? '正在保存…' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
