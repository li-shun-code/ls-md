import { memo } from 'react'
import { ListTree } from 'lucide-react'
import type { OutlineItem } from '@renderer/utils/markdown'

type OutlineProps = {
  items: OutlineItem[]
  activeLine: number
  onSelect: (item: OutlineItem) => void
}

function OutlineImpl({ items, activeLine, onSelect }: OutlineProps) {
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
      {items.map((item) => (
        <button
          type="button"
          role="treeitem"
          key={item.id}
          className={`outline-row${activeLine === item.line ? ' is-active' : ''}`}
          style={{ paddingLeft: `${16 + (item.level - 1) * 14}px` }}
          onClick={() => onSelect(item)}
          title={`跳转到第 ${item.line} 行`}
        >
          <span>{item.text}</span>
        </button>
      ))}
    </div>
  )
}

export const Outline = memo(OutlineImpl)
