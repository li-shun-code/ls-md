import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo)
    void window.desktop?.logToFile?.('error', 'ErrorBoundary 捕获未处理异常', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    }).catch(() => undefined)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleCopyError = (): void => {
    const text = [
      `Error: ${this.state.error?.message ?? 'Unknown error'}`,
      `Stack:\n${this.state.error?.stack ?? 'No stack'}`,
      `Component Stack:\n${this.state.errorInfo?.componentStack ?? 'No component stack'}`,
    ].join('\n\n')

    void navigator.clipboard.writeText(text).then(() => {
      window.alert('错误信息已复制到剪贴板')
    }).catch(() => undefined)
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen" role="alert">
          <div className="error-boundary-card">
            <div className="error-boundary-icon" aria-hidden="true">⚠️</div>
            <h1 className="error-boundary-title">编辑器渲染遇到了问题</h1>
            <p className="error-boundary-desc">
              应用已自动拦截此异常，防止窗口彻底白屏崩溃。你可以尝试重新载入页面恢复工作。
            </p>

            <div className="error-boundary-actions">
              <button
                type="button"
                className="error-boundary-btn is-primary"
                onClick={this.handleReload}
              >
                重新加载编辑器
              </button>
              <button
                type="button"
                className="error-boundary-btn"
                onClick={this.handleCopyError}
              >
                复制错误详情
              </button>
            </div>

            {this.state.error && (
              <details className="error-boundary-details">
                <summary>查看详细错误堆栈</summary>
                <pre>{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
