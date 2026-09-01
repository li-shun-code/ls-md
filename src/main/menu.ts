import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import type { MenuCommand } from '../shared/types'

function sendCommand(window: BrowserWindow | null, command: MenuCommand): void {
  if (!window || window.isDestroyed()) {
    return
  }

  window.webContents.send('menu-command', command)
}

export type ApplicationMenuOptions = {
  recentFiles?: string[]
  onOpenRecent?: (filePath: string) => void
  onClearRecent?: () => void
}

export function buildApplicationMenu(
  getWindow: () => BrowserWindow | null,
  options?: ApplicationMenuOptions
): Menu {
  const recentFiles = options?.recentFiles ?? []
  const onOpenRecent = options?.onOpenRecent
  const onClearRecent = options?.onClearRecent

  const command = (label: string, commandName: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => sendCommand(getWindow(), commandName),
  })

  const recentSubmenu: MenuItemConstructorOptions[] = recentFiles.length > 0
    ? [
        ...recentFiles.slice(0, 20).map((filePath) => ({
          label: path.basename(filePath) || filePath,
          sublabel: filePath,
          toolTip: filePath,
          click: () => onOpenRecent?.(filePath),
        })),
        { type: 'separator' },
        {
          label: '清除最近打开记录',
          click: () => onClearRecent?.(),
        },
      ]
    : [
        {
          label: '(无最近打开记录)',
          enabled: false,
        },
      ]

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        command('新建', 'file.new', 'Ctrl+N'),
        command('打开文件夹…', 'file.openFolder', 'Ctrl+Shift+O'),
        command('打开 Markdown…', 'file.open', 'Ctrl+O'),
        {
          label: '打开最近文件',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        command('保存', 'file.save', 'Ctrl+S'),
        command('另存为…', 'file.saveAs', 'Ctrl+Shift+S'),
        { type: 'separator' },
        command('导出为 HTML…', 'file.exportHtml'),
        command('导出为 PDF…', 'file.exportPdf'),
        command('打印…', 'file.print', 'Ctrl+P'),
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        command('撤销', 'edit.undo', 'Ctrl+Z'),
        command('重做', 'edit.redo', 'Ctrl+Y'),
        { type: 'separator' },
        command('剪切', 'edit.cut', 'Ctrl+X'),
        command('复制', 'edit.copy', 'Ctrl+C'),
        command('粘贴', 'edit.paste', 'Ctrl+V'),
        command('全选', 'edit.selectAll', 'Ctrl+A'),
      ],
    },
    {
      label: '段落',
      submenu: [
        command('一级标题', 'paragraph.heading1'),
        command('二级标题', 'paragraph.heading2'),
        command('三级标题', 'paragraph.heading3'),
        command('插入表格', 'paragraph.table'),
        { type: 'separator' },
        command('无序列表', 'paragraph.bulletList'),
        command('有序列表', 'paragraph.orderedList'),
        command('任务列表', 'paragraph.taskList'),
        command('引用', 'paragraph.blockquote'),
        command('代码块', 'paragraph.codeBlock'),
        command('分隔线', 'paragraph.horizontalRule'),
      ],
    },
    {
      label: '格式',
      submenu: [
        command('加粗', 'format.bold', 'Ctrl+B'),
        command('斜体', 'format.italic', 'Ctrl+I'),
        command('删除线', 'format.strike'),
        command('行内代码', 'format.inlineCode'),
      ],
    },
    {
      label: '视图',
      submenu: [
        command('显示/隐藏侧栏', 'view.toggleSidebar', 'Ctrl+Shift+L'),
        command('显示/隐藏大纲', 'view.toggleOutline'),
        command('切换源码模式', 'view.toggleSource', 'Ctrl+/'),
        command('专注模式', 'view.toggleFocus', 'Ctrl+Shift+F'),
        { type: 'separator' },
        command('放大', 'view.zoomIn', 'Ctrl+='),
        command('缩小', 'view.zoomOut', 'Ctrl+-'),
        command('重置缩放', 'view.resetZoom'),
      ],
    },
    {
      label: '主题',
      submenu: [command('切换浅色/深色', 'theme.toggle')],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '功能介绍与示例文档',
          click: () => sendCommand(getWindow(), 'help.welcomeDocument'),
        },
        { type: 'separator' },
        {
          label: '快捷键',
          click: () => sendCommand(getWindow(), 'help.shortcuts'),
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
