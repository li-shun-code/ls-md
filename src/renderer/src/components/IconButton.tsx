import type { LucideIcon } from 'lucide-react'

type IconButtonProps = {
  icon: LucideIcon
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}

export function IconButton({ icon: Icon, label, onClick, active = false, disabled = false }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}
