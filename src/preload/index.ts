import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopBridge,
  AiStreamEvent,
  OpenedDocument,
  RecoverySnapshot,
  WorkspaceSelection,
} from '../shared/types'

const desktopBridge: DesktopBridge = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose') as Promise<string | null>,
  openMarkdownDialog: () => ipcRenderer.invoke('file:open-dialog') as Promise<void>,
  openMarkdownPath: (path) => ipcRenderer.invoke('file:open-path', path) as Promise<void>,
  listWorkspace: (root) => ipcRenderer.invoke('workspace:list', root) as Promise<WorkspaceSelection['tree']>,
  readMarkdown: (path) => ipcRenderer.invoke('file:read', path) as Promise<string>,
  writeMarkdown: (path, content) => ipcRenderer.invoke('file:write', path, content) as Promise<void>,
  saveMarkdownAs: (path, content) => ipcRenderer.invoke('file:save-as', path, content) as Promise<OpenedDocument | null>,
  copyAsset: (sourcePath, root) => ipcRenderer.invoke('asset:copy', sourcePath, root) as Promise<string>,
  exportHtml: (path, html) => ipcRenderer.invoke('file:export-html', path, html) as Promise<boolean>,
  exportPdf: (path, html) => ipcRenderer.invoke('file:export-pdf', path, html) as Promise<boolean>,
  print: () => ipcRenderer.invoke('file:print') as Promise<boolean>,
  writeRecovery: (snapshot) => ipcRenderer.invoke('recovery:write', snapshot) as Promise<void>,
  readRecovery: (path) => ipcRenderer.invoke('recovery:read', path) as Promise<RecoverySnapshot | null>,
  clearRecovery: (path) => ipcRenderer.invoke('recovery:clear', path) as Promise<void>,
  getAiSettings: () => ipcRenderer.invoke('ai:settings:get'),
  saveAiSettings: (settings) => ipcRenderer.invoke('ai:settings:save', settings),
  startAiRequest: (request) => ipcRenderer.invoke('ai:request:start', request),
  cancelAiRequest: (requestId) => ipcRenderer.invoke('ai:request:cancel', requestId),
  resolvePath: (baseDir, targetPath) => ipcRenderer.invoke('file:resolve-path', baseDir, targetPath),
  openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
  onAiStream: (callback) => subscribe<AiStreamEvent>('ai-stream', callback),
  onMenuCommand: (callback) => subscribe('menu-command', callback),
  onWorkspaceSelected: (callback) => subscribe('workspace-selected', callback),
  onDocumentOpened: (callback) => subscribe('document-opened', callback),
  onFileChanged: (callback) => subscribe('file-changed', callback),
}

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('desktop', desktopBridge)
