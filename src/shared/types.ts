export type MarkdownMode = 'wysiwyg' | 'source'

export type FileNode = {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

export type DocumentState = {
  path: string
  markdown: string
  mode: MarkdownMode
  dirty: boolean
  cursor: { line: number; column: number }
}

export type RecoverySnapshot = {
  path: string
  markdown: string
  createdAt: number
}

export type WorkspaceSelection = {
  root: string
  tree: FileNode[]
}

export type OpenedDocument = {
  path: string
  content: string
}

export type AiOperation =
  | 'qa'
  | 'polish'
  | 'expand'
  | 'shorten'
  | 'translate'
  | 'proofread'
  | 'continue'
  | 'summarize'

export type AiMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AiContextChunk = {
  id: string
  text: string
  heading: string
  startLine: number
  endLine: number
}

export type AiSelection = {
  text: string
  startLine: number
  endLine: number
}

export type AiCitation = {
  id: string
  heading: string
  startLine: number
  endLine: number
  snippet: string
}

export type AiSettings = {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
}

export type AiSettingsInput = {
  baseUrl: string
  model: string
  apiKey?: string
}

export type RunnerDefinition = {
  id: string
  name: string
  language: string
  extension: string
  commandTemplate: string
  enabled: boolean
  detectedPath?: string
  detectedVersion?: string
}

export type ExecutionRequest = {
  executionId: string
  language: string
  code: string
  documentPath?: string
  workingDirectory?: string
}

export type ExecutionResult = {
  executionId: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  error?: string
}

export type AppSettings = {
  runners: Record<string, RunnerDefinition>
  ai: AiSettings
}

export type AiRequest = {
  requestId: string
  operation: AiOperation
  prompt: string
  documentTitle: string
  history: AiMessage[]
  context: AiContextChunk[]
  selection?: AiSelection
}

export type AiStreamEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; citations: AiCitation[] }
  | { requestId: string; type: 'error'; message: string }

export type MenuCommand =
  | 'file.new'
  | 'file.openFolder'
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'file.exportHtml'
  | 'file.exportPdf'
  | 'file.print'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.selectAll'
  | 'format.bold'
  | 'format.italic'
  | 'format.strike'
  | 'format.inlineCode'
  | 'paragraph.heading1'
  | 'paragraph.heading2'
  | 'paragraph.heading3'
  | 'paragraph.table'
  | 'paragraph.bulletList'
  | 'paragraph.orderedList'
  | 'paragraph.taskList'
  | 'paragraph.blockquote'
  | 'paragraph.codeBlock'
  | 'paragraph.horizontalRule'
  | 'view.toggleSidebar'
  | 'view.toggleOutline'
  | 'view.toggleSource'
  | 'view.toggleFocus'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.resetZoom'
  | 'theme.toggle'
  | 'help.shortcuts'
  | 'help.welcomeDocument'
  | 'settings.open'

export type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported'
  /** 新版本号（available / downloading / downloaded 时存在） */
  version?: string
  /** 下载进度百分比（downloading 时存在） */
  percent?: number
  /** 失败原因（error 时存在） */
  error?: string
}

export type DesktopBridge = {
  chooseWorkspace: () => Promise<string | null>
  openMarkdownDialog: () => Promise<void>
  openMarkdownPath: (path: string) => Promise<void>
  listWorkspace: (root: string) => Promise<FileNode[]>
  readMarkdown: (path: string) => Promise<string>
  writeMarkdown: (path: string, content: string) => Promise<void>
  saveMarkdownAs: (sourcePath: string, content: string) => Promise<OpenedDocument | null>
  copyAsset: (sourcePath: string, workspaceRoot: string) => Promise<string>
  exportHtml: (path: string, html: string) => Promise<boolean>
  exportPdf: (path: string, html: string) => Promise<boolean>
  print: () => Promise<boolean>
  writeRecovery: (snapshot: RecoverySnapshot) => Promise<void>
  readRecovery: (path: string) => Promise<RecoverySnapshot | null>
  clearRecovery: (path: string) => Promise<void>
  getAiSettings: () => Promise<AiSettings>
  saveAiSettings: (settings: AiSettingsInput) => Promise<AiSettings>
  startAiRequest: (request: AiRequest) => Promise<string>
  cancelAiRequest: (requestId: string) => Promise<void>
  resolvePath: (baseDir: string, targetPath: string) => Promise<string | null>
  openExternal: (url: string) => Promise<boolean>
  showInFolder: (filePath: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<string>
  trashFile: (filePath: string) => Promise<boolean>
  createFile: (directoryPath: string, fileName: string) => Promise<string>
  createFolder: (directoryPath: string, folderName: string) => Promise<string>
  getSettings: () => Promise<AppSettings>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  setTheme: (theme: 'light' | 'dark') => Promise<void>
  detectEnvironments: (forceRefresh?: boolean) => Promise<Record<string, { available: boolean; path?: string; version?: string }>>
  executeCode: (request: ExecutionRequest) => Promise<ExecutionResult>
  cancelExecution: (executionId: string) => Promise<boolean>
  checkForUpdates: () => Promise<UpdateState>
  installUpdate: () => Promise<void>
  getUpdateState: () => Promise<UpdateState>
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
  onAiStream: (callback: (event: AiStreamEvent) => void) => () => void
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void
  onWorkspaceSelected: (callback: (selection: WorkspaceSelection) => void) => () => void
  onDocumentOpened: (callback: (document: OpenedDocument) => void) => () => void
  onFileChanged: (callback: (path: string) => void) => () => void
  logToFile: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => Promise<void>
}

export type DesktopApi = DesktopBridge

