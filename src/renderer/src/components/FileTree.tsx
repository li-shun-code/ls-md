import { memo, useState, useCallback, type MouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  RotateCw,
  Trash2,
} from 'lucide-react'
import type { FileNode } from '@shared/types'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

export type FileTreeProps = {
  nodes: FileNode[]
  workspaceRoot: string | null
  activePath: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onRefresh?: () => void
  onNotice?: (message: string) => void
  onOpenFile?: (path: string) => void
  onDeleteFile?: (path: string) => void
  onRenameFile?: (oldPath: string, newPath: string) => void
}

function FileTreeImpl({
  nodes,
  workspaceRoot,
  activePath,
  expandedPaths,
  onToggle,
  onSelect,
  onRefresh,
  onNotice,
  onOpenFile,
  onDeleteFile,
  onRenameFile,
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  const handleContainerContextMenu = useCallback((event: MouseEvent) => {
    // If target is inside a tree-row button, the node context menu handles it
    if ((event.target as HTMLElement).closest('.tree-row')) return
    event.preventDefault()

    if (!workspaceRoot) return

    const items: ContextMenuItem[] = [
      {
        id: 'new-file-root',
        label: '新建 Markdown 文档',
        icon: <FilePlus size={14} />,
        onClick: async () => {
          const name = window.prompt('请输入新建 Markdown 文件名：', '新文档.md')
          if (!name?.trim()) return
          try {
            const created = await window.desktop.createFile(workspaceRoot, name.trim())
            onOpenFile?.(created)
            onNotice?.(`已创建文档：${name.trim()}`)
          } catch (err) {
            onNotice?.(err instanceof Error ? err.message : '创建文档失败')
          }
        },
      },
      {
        id: 'new-folder-root',
        label: '新建文件夹',
        icon: <FolderPlus size={14} />,
        onClick: async () => {
          const name = window.prompt('请输入文件夹名称：', '新建文件夹')
          if (!name?.trim()) return
          try {
            await window.desktop.createFolder(workspaceRoot, name.trim())
            onNotice?.(`已创建文件夹：${name.trim()}`)
          } catch (err) {
            onNotice?.(err instanceof Error ? err.message : '创建文件夹失败')
          }
        },
      },
      { type: 'separator' },
      {
        id: 'refresh-root',
        label: '刷新文件列表',
        icon: <RotateCw size={14} />,
        onClick: () => {
          onRefresh?.()
          onNotice?.('已刷新文件列表')
        },
      },
      {
        id: 'show-in-folder-root',
        label: '在资源管理器中打开',
        icon: <FolderSearch size={14} />,
        onClick: () => {
          void window.desktop.showInFolder(workspaceRoot)
        },
      },
    ]

    setContextMenu({ x: event.clientX, y: event.clientY, items })
  }, [onNotice, onOpenFile, onRefresh, workspaceRoot])

  const handleNodeContextMenu = useCallback((event: MouseEvent, node: FileNode) => {
    event.preventDefault()
    event.stopPropagation()

    const isDirectory = node.kind === 'directory'
    const items: ContextMenuItem[] = []

    if (isDirectory) {
      items.push(
        {
          id: 'new-file-dir',
          label: '在此新建文档',
          icon: <FilePlus size={14} />,
          onClick: async () => {
            const name = window.prompt(`在「${node.name}」中新建 Markdown 文件：`, '新文档.md')
            if (!name?.trim()) return
            try {
              const created = await window.desktop.createFile(node.path, name.trim())
              onOpenFile?.(created)
              onNotice?.(`已创建文档：${name.trim()}`)
            } catch (err) {
              onNotice?.(err instanceof Error ? err.message : '创建文档失败')
            }
          },
        },
        {
          id: 'new-folder-dir',
          label: '在此新建文件夹',
          icon: <FolderPlus size={14} />,
          onClick: async () => {
            const name = window.prompt(`在「${node.name}」中新建文件夹：`, '新建文件夹')
            if (!name?.trim()) return
            try {
              await window.desktop.createFolder(node.path, name.trim())
              onNotice?.(`已创建文件夹：${name.trim()}`)
            } catch (err) {
              onNotice?.(err instanceof Error ? err.message : '创建文件夹失败')
            }
          },
        },
        { type: 'separator' },
        {
          id: 'rename-dir',
          label: '重命名',
          icon: <Edit3 size={14} />,
          onClick: async () => {
            const name = window.prompt('请输入新的文件夹名称：', node.name)
            if (!name?.trim() || name.trim() === node.name) return
            try {
              const renamed = await window.desktop.renameFile(node.path, name.trim())
              onRenameFile?.(node.path, renamed)
              onNotice?.(`已重命名为：${name.trim()}`)
            } catch (err) {
              onNotice?.(err instanceof Error ? err.message : '重命名失败')
            }
          },
        },
        {
          id: 'trash-dir',
          label: '移至回收站',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: async () => {
            if (!window.confirm(`确定要将文件夹「${node.name}」移至回收站吗？`)) return
            try {
              await window.desktop.trashFile(node.path)
              onDeleteFile?.(node.path)
              onNotice?.(`已将「${node.name}」移入回收站`)
            } catch (err) {
              onNotice?.(err instanceof Error ? err.message : '删除失败')
            }
          },
        },
        { type: 'separator' },
        {
          id: 'show-in-folder-dir',
          label: '在资源管理器中显示',
          icon: <FolderSearch size={14} />,
          onClick: () => {
            void window.desktop.showInFolder(node.path)
          },
        },
      )
    } else {
      // 文件节点
      items.push(
        {
          id: 'rename-file',
          label: '重命名',
          icon: <Edit3 size={14} />,
          onClick: async () => {
            const name = window.prompt('请输入新的文件名：', node.name)
            if (!name?.trim() || name.trim() === node.name) return
            try {
              const renamed = await window.desktop.renameFile(node.path, name.trim())
              onRenameFile?.(node.path, renamed)
              onNotice?.(`已重命名为：${name.trim()}`)
            } catch (err) {
              onNotice?.(err instanceof Error ? err.message : '重命名失败')
            }
          },
        },
        {
          id: 'trash-file',
          label: '移至回收站',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: async () => {
            if (!window.confirm(`确定要将文档「${node.name}」移至回收站吗？`)) return
            try {
              await window.desktop.trashFile(node.path)
              onDeleteFile?.(node.path)
              onNotice?.(`已将「${node.name}」移入回收站`)
            } catch (err) {
              onNotice?.(err instanceof Error ? err.message : '删除失败')
            }
          },
        },
        { type: 'separator' },
        {
          id: 'copy-rel-path',
          label: '复制相对路径',
          icon: <Copy size={14} />,
          onClick: () => {
            const rel = workspaceRoot
              ? node.path.replace(workspaceRoot, '').replace(/^[\\/]+/, '')
              : node.name
            void navigator.clipboard.writeText(rel).then(() => {
              onNotice?.('已复制相对路径')
            }).catch(() => {
              onNotice?.('复制失败')
            })
          },
        },
        {
          id: 'copy-abs-path',
          label: '复制绝对路径',
          icon: <Copy size={14} />,
          onClick: () => {
            void navigator.clipboard.writeText(node.path).then(() => {
              onNotice?.('已复制绝对路径')
            }).catch(() => {
              onNotice?.('复制失败')
            })
          },
        },
        { type: 'separator' },
        {
          id: 'show-in-folder-file',
          label: '在资源管理器中显示',
          icon: <FolderSearch size={14} />,
          onClick: () => {
            void window.desktop.showInFolder(node.path)
          },
        },
      )
    }

    setContextMenu({ x: event.clientX, y: event.clientY, items })
  }, [onDeleteFile, onNotice, onOpenFile, onRenameFile, workspaceRoot])

  return (
    <div
      className="file-tree"
      role="tree"
      aria-label="工作区文件"
      onContextMenu={handleContainerContextMenu}
    >
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          onSelect={onSelect}
          onNodeContextMenu={handleNodeContextMenu}
        />
      ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

export const FileTree = memo(FileTreeImpl)

type FileTreeNodeProps = {
  node: FileNode
  depth: number
  activePath: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onNodeContextMenu: (event: MouseEvent, node: FileNode) => void
}

function FileTreeNode({
  node,
  depth,
  activePath,
  expandedPaths,
  onToggle,
  onSelect,
  onNodeContextMenu,
}: FileTreeNodeProps) {
  const isDirectory = node.kind === 'directory'
  const expanded = expandedPaths.has(node.path)

  return (
    <div role="treeitem" aria-expanded={isDirectory ? expanded : undefined}>
      <button
        type="button"
        className={`tree-row${activePath === node.path ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => (isDirectory ? onToggle(node.path) : onSelect(node.path))}
        onContextMenu={(event) => onNodeContextMenu(event, node)}
        title={node.path}
      >
        {isDirectory ? (
          <span className="tree-chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="tree-chevron spacer" aria-hidden="true" />
        )}
        {isDirectory ? (
          expanded ? <FolderOpen size={16} strokeWidth={1.7} aria-hidden="true" /> : <Folder size={16} strokeWidth={1.7} aria-hidden="true" />
        ) : (
          <FileText size={16} strokeWidth={1.7} aria-hidden="true" />
        )}
        <span className="tree-label">{node.name}</span>
      </button>
      {isDirectory && expanded && node.children && (
        <div role="group">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onSelect={onSelect}
              onNodeContextMenu={onNodeContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}
