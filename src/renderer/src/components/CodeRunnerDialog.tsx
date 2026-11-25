import { useCallback, useEffect, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
  bracketMatching,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FolderOpen,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type { ExecutionResult } from '@shared/types'

export type CodeRunnerDialogProps = {
  language: string
  initialCode: string
  workingDirectory?: string
  onClose: () => void
  onNotice: (message: string) => void
}

/** 根据语言名解析 @codemirror/language-data 中的语言描述（找不到返回 null） */
function languageDescription(language: string) {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return null
  return (
    languages.find(
      (desc) =>
        desc.name.toLowerCase() === normalized ||
        desc.alias.some((alias) => alias.toLowerCase() === normalized)
    ) ?? null
  )
}

type Phase = 'idle' | 'running' | 'done' | 'cancelled'

export function CodeRunnerDialog({
  language,
  initialCode,
  workingDirectory,
  onClose,
  onNotice,
}: CodeRunnerDialogProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const [copied, setCopied] = useState(false)
  const executionIdRef = useRef<string | null>(null)
  const codeRef = useRef(initialCode)
  const runRef = useRef<() => void>(() => undefined)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // CodeMirror 编辑器（挂载一次；App 条件渲染保证每次打开是新实例）
  useEffect(() => {
    const host = editorHostRef.current
    if (!host) return
    const languageCompartment = new Compartment()
    const state = EditorState.create({
      doc: initialCode,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current()
              return true
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) codeRef.current = update.state.doc.toString()
        }),
        languageCompartment.of([]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '15px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
          '.cm-content': { padding: '12px 0' },
          '.cm-gutters': { background: 'transparent', borderRight: '1px solid var(--border)' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    view.focus()

    // 异步加载语言高亮（language-data 的 load() 为异步）
    const desc = languageDescription(language)
    if (desc) {
      void desc
        .load()
        .then((extension) => {
          const current = viewRef.current
          if (!current) return
          current.dispatch({ effects: languageCompartment.reconfigure(extension) })
        })
        .catch(() => undefined)
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 组件随 App 条件渲染，语言/初始代码仅需挂载时生效
  }, [])

  const handleRun = useCallback(async () => {
    if (phase === 'running') return
    setPhase('running')
    setResult(null)
    const executionId = `run-dialog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    executionIdRef.current = executionId

    if (!window.desktop?.executeCode) {
      setResult({
        executionId,
        stdout: '',
        stderr: '代码执行服务不可用',
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      })
      setPhase('done')
      return
    }

    try {
      const r = await window.desktop.executeCode({
        executionId,
        language,
        code: codeRef.current,
        workingDirectory,
      })
      if (executionIdRef.current !== executionId) return
      setResult(r)
      setPhase('done')
    } catch (error) {
      if (executionIdRef.current !== executionId) return
      setResult({
        executionId,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        durationMs: 0,
        timedOut: false,
      })
      setPhase('done')
    }
  }, [language, phase, workingDirectory])
  runRef.current = handleRun

  // 打开对话框时自动执行一次，获取初始输出；用户亦可在编辑后再次手动触发运行
  useEffect(() => {
    void handleRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCancel = useCallback(() => {
    const id = executionIdRef.current
    if (!id) return
    void window.desktop?.cancelExecution?.(id)
    executionIdRef.current = null
    setPhase('cancelled')
  }, [])

  const handleClose = useCallback(() => {
    if (phase === 'running') {
      const id = executionIdRef.current
      if (id) void window.desktop?.cancelExecution?.(id)
    }
    onClose()
  }, [onClose, phase])

  const handleResetCode = useCallback(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: initialCode },
    })
    codeRef.current = initialCode
    onNotice('已恢复为初始代码')
  }, [initialCode, onNotice])

  const handleClearOutput = useCallback(() => {
    setResult(null)
    setPhase('idle')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleClose])

  const status =
    phase === 'running'
      ? { text: '运行中…', className: 'is-running', icon: Loader2, spin: true }
      : phase === 'cancelled'
        ? { text: '已终止', className: 'is-cancelled', icon: Square, spin: false }
        : !result
          ? { text: '就绪', className: 'is-idle', icon: Clock, spin: false }
          : result.timedOut
            ? { text: '超时 (15s)', className: 'is-timeout', icon: AlertCircle, spin: false }
            : result.exitCode === 0
              ? { text: '成功 (0)', className: 'is-success', icon: CheckCircle2, spin: false }
              : { text: `失败 (${result.exitCode ?? 1})`, className: 'is-error', icon: AlertCircle, spin: false }

  const StatusIcon = status.icon

  return (
    <div
      className="modal-backdrop code-runner-backdrop"
      role="presentation"
      onMouseDown={handleClose}
    >
      <section
        className="code-runner-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="代码运行控制台"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* 顶部主标题栏 */}
        <div className="code-runner-header">
          <div className="code-runner-title">
            <div className="code-runner-title-icon" aria-hidden="true">
              <Terminal size={16} />
            </div>
            <h2>代码运行</h2>
            <span className="code-runner-lang-badge">
              <span className="code-runner-lang-dot" aria-hidden="true" />
              {language || 'text'}
            </span>
          </div>

          <div className="code-runner-header-right">
            <span className={`code-runner-status ${status.className}`}>
              <StatusIcon size={12} className={status.spin ? 'settings-spin' : ''} aria-hidden="true" />
              <span>{status.text}</span>
            </span>
            <button
              type="button"
              className="dialog-close"
              aria-label="关闭 (Esc)"
              title="关闭 (Esc)"
              onClick={handleClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 辅助工具栏：工作目录、代码重置与快捷键提示 */}
        <div className="code-runner-subbar">
          <div className="code-runner-cwd-chip" title={workingDirectory ?? '系统临时沙箱目录'}>
            <FolderOpen size={13} className="code-runner-cwd-icon" aria-hidden="true" />
            <span className="code-runner-cwd-text">
              {workingDirectory ? `工作目录：${workingDirectory}` : '工作目录：系统临时沙箱环境'}
            </span>
          </div>
          <div className="code-runner-subbar-tools">
            <button
              type="button"
              className="code-runner-tool-btn"
              onClick={handleResetCode}
              title="恢复为 Markdown 文档中的初始代码"
            >
              <RotateCcw size={12} aria-hidden="true" />
              <span>重置代码</span>
            </button>
            <span className="code-runner-shortcut-hint">
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 运行
            </span>
          </div>
        </div>

        {/* 代码编辑器区域 */}
        <div className="code-runner-editor" ref={editorHostRef} />

        {/* 操作栏 */}
        <div className="code-runner-footer">
          <div className="code-runner-footer-left">
            {phase === 'running' ? (
              <button
                type="button"
                className="runner-action-btn is-stop"
                onClick={handleCancel}
                title="终止正在运行的进程"
              >
                <Square size={14} fill="currentColor" aria-hidden="true" />
                <span>终止运行</span>
              </button>
            ) : (
              <button
                type="button"
                className="runner-action-btn is-run"
                onClick={() => void handleRun()}
                title="执行当前编辑器中的代码 (Ctrl+Enter)"
              >
                <Play size={14} fill="currentColor" aria-hidden="true" />
                <span>运行代码</span>
                <span className="runner-action-key">Ctrl+Enter</span>
              </button>
            )}
          </div>

          <div className="code-runner-actions">
            {(result || phase !== 'idle') && (
              <button
                type="button"
                className="runner-action-btn is-ghost"
                onClick={handleClearOutput}
                title="清空当前控制台输出"
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>清空输出</span>
              </button>
            )}
            <button
              type="button"
              className="runner-action-btn is-ghost"
              onClick={handleClose}
              title="关闭控制台"
            >
              关闭
            </button>
          </div>
        </div>

        {/* 终端输出区域 */}
        <div className="code-runner-output-area">
          <div className="code-runner-output-meta">
            <div className="code-runner-term-traffic">
              <span className="term-dot is-red" />
              <span className="term-dot is-yellow" />
              <span className="term-dot is-green" />
              <span className="code-runner-term-title">控制台输出</span>
            </div>

            <div className="code-runner-meta-right">
              {result && result.durationMs > 0 && (
                <span className="code-runner-duration">
                  <Clock size={11} aria-hidden="true" />
                  <span>{result.durationMs}ms</span>
                </span>
              )}
              {result && (result.stdout || result.stderr || result.error) && (
                <button
                  type="button"
                  className="code-output-copy-btn"
                  onClick={() => {
                    const text = [result.stdout, result.stderr, result.error]
                      .filter(Boolean)
                      .join('\n')
                    void navigator.clipboard
                      .writeText(text)
                      .then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                        onNotice?.('已复制运行输出')
                      })
                      .catch(() => {
                        onNotice?.('复制失败')
                      })
                  }}
                  title="复制终端全部输出"
                >
                  {copied ? (
                    <Check size={12} aria-hidden="true" />
                  ) : (
                    <Copy size={12} aria-hidden="true" />
                  )}
                  <span>{copied ? '已复制' : '复制输出'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="code-runner-terminal-body">
            {phase === 'running' && !result && (
              <div className="runner-output-loading">
                <Loader2 size={14} className="settings-spin" aria-hidden="true" />
                <span>正在执行进程，等待实时输出…</span>
              </div>
            )}
            {phase === 'idle' && !result && (
              <div className="runner-output-placeholder">
                <Terminal size={15} aria-hidden="true" />
                <span>就绪。点击上方「运行代码」或按快捷键 Ctrl+Enter 开始执行。</span>
              </div>
            )}
            {result?.error && !result.stdout && !result.stderr && (
              <pre className="runner-output runner-output-error">{result.error}</pre>
            )}
            {result?.stdout && <pre className="runner-output runner-output-stdout">{result.stdout}</pre>}
            {result?.stderr && <pre className="runner-output runner-output-stderr">{result.stderr}</pre>}
            {phase === 'done' && result && !result.stdout && !result.stderr && !result.error && (
              <pre className="runner-output runner-output-stdout is-muted">(进程执行完毕，无标准输出)</pre>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}