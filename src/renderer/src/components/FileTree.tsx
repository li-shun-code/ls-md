import { memo } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'
import type { FileNode } from '@shared/types'

type FileTreeProps = {
  nodes: FileNode[]
  activePath: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

function FileTreeImpl({ nodes, activePath, expandedPaths, onToggle, onSelect }: FileTreeProps) {
  return (
    <div className="file-tree" role="tree" aria-label="工作区文件">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export const FileTree = memo(FileTreeImpl)

function FileTreeNode({ node, depth, activePath, expandedPaths, onToggle, onSelect }: FileTreeProps & { node: FileNode; depth: number }) {
  const isDirectory = node.kind === 'directory'
  const expanded = expandedPaths.has(node.path)

  return (
    <div role="treeitem" aria-expanded={isDirectory ? expanded : undefined}>
      <button
        type="button"
        className={`tree-row${activePath === node.path ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => (isDirectory ? onToggle(node.path) : onSelect(node.path))}
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
