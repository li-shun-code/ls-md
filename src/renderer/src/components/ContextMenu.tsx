import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type ContextMenuItem =
  | { type: 'separator' }
  | {
      type: 'header'
      label: string
      icon?: ReactNode
    }
  | {
      type?: 'item'
      id: string
      label: string
      icon?: ReactNode
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      onClick: () => void
    }

export type ContextMenuProps = {
  x: number
  y: number
  items: ContextMenuItem[]
  ariaLabel?: string
  onClose: () => void
}

export function ContextMenu({ x, y, items, ariaLabel, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const padding = 8

    let left = x
    let top = y

    if (left + rect.width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - rect.width - padding)
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = Math.max(padding, window.innerHeight - rect.height - padding)
    }

    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleMouseDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [onClose])

  const effectiveLabel = ariaLabel || (items[0]?.type === 'header' ? items[0].label : '操作菜单')

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      role="menu"
      aria-label={effectiveLabel}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="context-menu-separator" role="separator" />
        }

        if (item.type === 'header') {
          return (
            <div key={`header-${index}`} className="context-menu-header">
              {item.icon && <span className="context-menu-icon">{item.icon}</span>}
              <span>{item.label}</span>
            </div>
          )
        }

        return (
          <button
            key={item.id}
            type="button"
            className={`context-menu-item${item.danger ? ' is-danger' : ''}${item.disabled ? ' is-disabled' : ''}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}
