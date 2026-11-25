import { memo, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ListTree } from 'lucide-react'
import type { OutlineItem } from '@renderer/utils/markdown'

type OutlineProps = {
  items: OutlineItem[]
  activeLine: number
  onSelect: (item: OutlineItem) => void
}

type OutlineNode = {
  item: OutlineItem
  children: OutlineNode[]
}

function buildTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []

  for (const item of items) {
    const node: OutlineNode = { item, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].item.level >= item.level) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  return roots
}

type OutlineNodeRowProps = {
  node: OutlineNode
  depth: number
  activeLine: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onSelect: (item: OutlineItem) => void
}

function OutlineNodeRow({ node, depth, activeLine, expandedIds, onToggle, onSelect }: OutlineNodeRowProps) {
  const { item, children } = node
  const hasChildren = children.length > 0
  const expanded = hasChildren && expandedIds.has(item.id)

  return (
    <div role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className="outline-row-wrap" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="outline-chevron"
            aria-label={expanded ? '收起' : '展开'}
            onClick={() => onToggle(item.id)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="outline-chevron spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className={`outline-row${activeLine === item.line ? ' is-active' : ''}`}
          onClick={() => onSelect(item)}
          title={`跳转到第 ${item.line} 行`}
        >
          <span>{item.text}</span>
        </button>
      </div>
      {expanded && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <OutlineNodeRow
              key={child.item.id}
              node={child}
              depth={depth + 1}
              activeLine={activeLine}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OutlineImpl({ items, activeLine, onSelect }: OutlineProps) {
  const tree = useMemo(() => buildTree(items), [items])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set<string>())

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (items.length === 0) {
    return (
      <div className="outline-empty">
        <ListTree size={18} strokeWidth={1.6} aria-hidden="true" />
        <span>输入标题后，这里会显示文档大纲</span>
      </div>
    )
  }

  return (
    <div className="outline-list" role="tree" aria-label="文档大纲">
      {tree.map((node) => (
        <OutlineNodeRow
          key={node.item.id}
          node={node}
          depth={0}
          activeLine={activeLine}
          expandedIds={expandedIds}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export const Outline = memo(OutlineImpl)
