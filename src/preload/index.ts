import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopBridge,
  AiStreamEvent,
  OpenedDocument,
  RecoverySnapshot,
  DocumentVersion,
  DocumentVersionSummary,
  WorkspaceSelection,
  UpdateState,
} from '../shared/types'

const desktopBridge: DesktopBridge = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose') as Promise<string | null>,
  openMarkdownDialog: () => ipcRenderer.invoke('file:open-dialog') as Promise<void>,
  openMarkdownPath: (path) => ipcRenderer.invoke('file:open-path', path) as Promise<void>,
  listWorkspace: (root) => ipcRenderer.invoke('workspace:list', root) as Promise<WorkspaceSelection['tree']>,
  readMarkdown: (path) => ipcRenderer.invoke('file:read', path) as Promise<string>,
  writeMarkdown: (path, content, reason) => ipcRenderer.invoke('file:write', path, content, reason) as Promise<void>,
  listDocumentVersions: (path) => ipcRenderer.invoke('document-versions:list', path) as Promise<DocumentVersionSummary[]>,
  readDocumentVersion: (path, id) => ipcRenderer.invoke('document-versions:read', path, id) as Promise<DocumentVersion | null>,
  saveMarkdownAs: (path, content) => ipcRenderer.invoke('file:save-as', path, content) as Promise<OpenedDocument | null>,
  copyAsset: (sourcePath, root) => ipcRenderer.invoke('asset:copy', sourcePath, root) as Promise<string>,
  exportHtml: (path, html) => ipcRenderer.invoke('file:export-html', path, html) as Promise<boolean>,
  exportPdf: (path, html) => ipcRenderer.invoke('file:export-pdf', path, html) as Promise<boolean>,
  exportDocx: (path, html) => ipcRenderer.invoke('file:export-docx', path, html) as Promise<boolean>,
  print: () => ipcRenderer.invoke('file:print') as Promise<boolean>,
  writeRecovery: (snapshot) => ipcRenderer.invoke('recovery:write', snapshot) as Promise<void>,
  readRecovery: (path) => ipcRenderer.invoke('recovery:read', path) as Promise<RecoverySnapshot | null>,
  clearRecovery: (path) => ipcRenderer.invoke('recovery:clear', path) as Promise<void>,
  getAiSettings: () => ipcRenderer.invoke('ai:settings:get'),
  saveAiSettings: (settings) => ipcRenderer.invoke('ai:settings:save', settings),
  getWritingMemory: () => ipcRenderer.invoke('ai:writing-memory:get'),
  saveWritingMemory: (memory) => ipcRenderer.invoke('ai:writing-memory:save', memory),
  learnWritingMemory: (sample) => ipcRenderer.invoke('ai:writing-memory:learn', sample),
  startAiRequest: (request) => ipcRenderer.invoke('ai:request:start', request),
  cancelAiRequest: (requestId) => ipcRenderer.invoke('ai:request:cancel', requestId),
  resolvePath: (baseDir, targetPath) => ipcRenderer.invoke('file:resolve-path', baseDir, targetPath),
  openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
  showInFolder: (filePath) => ipcRenderer.invoke('file:show-in-folder', filePath),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('file:rename', oldPath, newName),
  trashFile: (filePath) => ipcRenderer.invoke('file:trash', filePath),
  createFile: (directoryPath, fileName) => ipcRenderer.invoke('file:create-file', directoryPath, fileName),
  createFolder: (directoryPath, folderName) => ipcRenderer.invoke('file:create-folder', directoryPath, folderName),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  setTheme: (theme) => ipcRenderer.invoke('app:theme', theme),
  detectEnvironments: (forceRefresh?: boolean) => ipcRenderer.invoke('runner:detect-env', forceRefresh),
  executeCode: (request) => ipcRenderer.invoke('runner:execute', request),
  cancelExecution: (id) => ipcRenderer.invoke('runner:cancel', id),
  checkForUpdates: () => ipcRenderer.invoke('update:check') as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<void>,
  getUpdateState: () => ipcRenderer.invoke('update:get-state') as Promise<UpdateState>,
  onUpdateState: (callback) => subscribe<UpdateState>('update-state', callback),
  onAiStream: (callback) => subscribe<AiStreamEvent>('ai-stream', callback),
  onMenuCommand: (callback) => subscribe('menu-command', callback),
  onWorkspaceSelected: (callback) => subscribe('workspace-selected', callback),
  onDocumentOpened: (callback) => subscribe('document-opened', callback),
  onFileChanged: (callback) => subscribe('file-changed', callback),
  logToFile: (level, message, meta) => ipcRenderer.invoke('app:log', level, message, meta),
}

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('desktop', desktopBridge)
