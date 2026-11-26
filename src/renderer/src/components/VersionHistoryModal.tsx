import { useEffect, useState } from 'react'
import { Clock3, FileText, History, RotateCcw, X } from 'lucide-react'
import type { DocumentVersion, DocumentVersionSummary } from '@shared/types'

type VersionHistoryModalProps = {
  open: boolean
  documentPath: string
  onClose: () => void
  onRestore: (markdown: string) => Promise<void>
}

function reasonLabel(reason: DocumentVersionSummary['reason']): string {
  if (reason === 'auto') return '自动保存前'
  if (reason === 'restore') return '恢复前'
  return '手动保存前'
}

export function VersionHistoryModal({ open, documentPath, onClose, onRestore }: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([])
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !documentPath) return
    let active = true
    setIsLoading(true)
    setError('')
    setSelectedVersion(null)
    void window.desktop.listDocumentVersions(documentPath).then(async (items) => {
      if (!active) return
      setVersions(items)
      const latest = items[0]
      if (!latest) return
      const version = await window.desktop.readDocumentVersion(documentPath, latest.id)
      if (active) setSelectedVersion(version)
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : '无法读取版本历史')
    }).finally(() => {
      if (active) setIsLoading(false)
    })
    return () => { active = false }
  }, [documentPath, open])

  const selectVersion = async (versionId: string) => {
    setIsLoading(true)
    setError('')
    try {
      const version = await window.desktop.readDocumentVersion(documentPath, versionId)
      if (!version) throw new Error('找不到这个版本')
      setSelectedVersion(version)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取这个版本')
    } finally {
      setIsLoading(false)
    }
  }

  const restoreSelectedVersion = async () => {
    if (!selectedVersion || isRestoring) return
    setIsRestoring(true)
    setError('')
    try {
      await onRestore(selectedVersion.markdown)
      onClose()
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '恢复版本失败')
    } finally {
      setIsRestoring(false)
    }
  }

  if (!open) return null

  return (
    <div className="version-modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-modal-title">
        <header className="version-modal-header">
          <div className="version-modal-title">
            <History size={18} strokeWidth={1.8} aria-hidden="true" />
            <div>
              <h2 id="version-modal-title">版本历史</h2>
              <span title={documentPath}>{documentPath.split(/[\\/]/).pop()}</span>
            </div>
          </div>
          <button type="button" className="version-modal-close" aria-label="关闭版本历史" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="version-modal-content">
          <div className="version-list" aria-label="保存的版本">
            {isLoading && versions.length === 0 && <p className="version-empty">正在读取版本…</p>}
            {!isLoading && versions.length === 0 && <p className="version-empty">保存文档后会在这里保留旧版本。</p>}
            {versions.map((version) => (
              <button
                type="button"
                key={version.id}
                className={`version-item${selectedVersion?.id === version.id ? ' is-active' : ''}`}
                aria-pressed={selectedVersion?.id === version.id}
                onClick={() => void selectVersion(version.id)}
              >
                <span className="version-item-date"><Clock3 size={13} aria-hidden="true" />{new Date(version.createdAt).toLocaleString('zh-CN')}</span>
                <small>{reasonLabel(version.reason)}</small>
                <span className="version-item-preview">{version.preview || '空文档'}</span>
              </button>
            ))}
          </div>

          <div className="version-preview" aria-label="版本预览">
            {selectedVersion ? (
              <>
                <div className="version-preview-heading">
                  <FileText size={15} aria-hidden="true" />
                  <span>{new Date(selectedVersion.createdAt).toLocaleString('zh-CN')} · {reasonLabel(selectedVersion.reason)}</span>
                </div>
                <pre>{selectedVersion.markdown || '（空文档）'}</pre>
              </>
            ) : (
              <p className="version-empty">选择一个版本查看内容。</p>
            )}
          </div>
        </div>

        <footer className="version-modal-footer">
          <div className="version-modal-error" role="status">{error}</div>
          <div>
            <button type="button" className="settings-modal-btn" onClick={onClose} disabled={isRestoring}>关闭</button>
            <button type="button" className="settings-modal-btn is-primary" onClick={() => void restoreSelectedVersion()} disabled={!selectedVersion || isRestoring}>
              <RotateCcw size={14} aria-hidden="true" />
              <span>{isRestoring ? '正在恢复…' : '恢复此版本'}</span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
