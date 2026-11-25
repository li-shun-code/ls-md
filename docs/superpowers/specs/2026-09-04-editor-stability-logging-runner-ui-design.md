# 墨笺：稳定性、日志、代码运行对话框与编辑体验优化 — 设计文档

> 日期：2026-09-04
> 状态：待用户评审

## 背景与目标

用户反馈四类问题/需求，按优先级排列：

1. **P0 崩溃且无迹可查**：在文件树中切换文档必触发「编辑窗口异常中断」（渲染进程异常终止）。即使报错也没有任何可追溯日志，日志无法写入安装目录。
2. **Python 中文乱码**：执行 Python 代码时输出中文乱码。
3. **Windows 下 bash 执行策略**：Windows 上执行 bash 脚本应优先使用 Git Bash，缺失时用 PowerShell 兼容执行。
4. **代码运行对话框**：点击代码块「运行」后弹出对话框，代码复制到对话框中编辑后执行，编辑不影响文档本体。
5. **MD 编辑体验对齐 Typora**：输入即时渲染、渲染与编辑无缝融合、快捷操作体验、界面与主题质感（四项全选）。
6. **UI 整体优化**：基于 ui-ux-pro 做界面打磨。

已确认的决策：
- 移除文档内嵌代码块输出面板，运行结果统一在对话框中展示。
- 日志写入安装目录 `logs/`，写入失败自动回退用户数据目录。

---

## 第一部分：日志基建（P0，先行）

### 目标

任何报错（渲染进程崩溃、主进程异常、渲染层未捕获异常）都必须写入应用可访问的日志文件：

- 安装目录：`<安装路径>/logs/`（`app.getAppPath()` 所在目录）
- 写入失败（如 Program Files 无写权限）自动回退：`<userData>/logs/`

### 新增文件

**`src/main/logger.ts`** — 文件日志模块

- API：`info(msg, meta?)`、`warn(msg, meta?)`、`error(msg, meta?)`、`flush()`、`getLogDirectory()`
- 实现：追加式文件写入（`fs/promises appendFile` + 写队列防并发交错；不做复杂异步日志库，避免引入依赖）
- 轮转：`app.log` 日滚动（`markdown-desk-YYYY-MM-DD.log`），保留最近 14 天，超限自动删除旧文件
- 编码：UTF-8；每行格式：`[ISO时间] [级别] 消息 — JSON元数据`（元数据含 error stack、reason、pid 等）
- 目录选择：优先 `<appPath>/logs`，`mkdir` 失败或首次 `appendFile` 失败时切到 `<userData>/logs`，并首次切换时在日志中记录实际路径
- 初始化：主进程启动早期（`app.whenReady` 前）就可用，不依赖 window

### 主进程接入（`src/main/index.ts`）

| 事件 | 内容 |
|---|---|
| 启动 | 版本、平台、ELECTRON_RENDERER_URL 是否存在、工作区根目录 |
| `render-process-gone` | 完整 `details`：`reason`、`exitCode`、`pid`、`wasOom`（若存在）；替换现有 `console.error` |
| `did-fail-load` | `errorCode`、`errorDescription`、`validatedURL`、`isMainFrame` |
| `unresponsive` | 触发时间，随后 `render-process-gone` 通常跟上 |
| `uncaughtException` / `unhandledRejection`（主进程） | 完整 stack |
| IPC handler 未捕获异常 | `ipcMain.handle` 内 try/catch 记录（本次主要为 `runner:*` 与 `file:*`） |
| 文档操作 | `openMarkdownFile` 成功/失败、`file:write` 成功/失败（带路径与大小） |

### 渲染进程接入

- **preload**（`src/preload/index.ts`）：新增暴露 `logToFile(level, message, meta)`（校内白名单：`info|warn|error`），经 `ipcRenderer.invoke('app:log', ...)` 到主进程写日志。同时主进程 `app:log` handler 校验 `isTrustedSender`。
- **`src/renderer/src/main.tsx`**：`window.onerror` / `unhandledrejection` 在现有 `console.error` 基础上，同时调用 `window.desktop.logToFile('error', ...)`（带 stack/url/line）。
- **`src/renderer/src/components/ErrorBoundary.tsx`**：`componentDidCatch` 上报 stack 到日志。
- **关键路径埋点**（文档切换）：App.tsx `openDocument` 入口/出口包 try/catch，日志记录：切换目标路径、readMarkdown 耗时、`setMarkdown` 后快照（可选：字符数）；MarkdownEditor 的 `setContent` effect 包 try/catch，失败时 `logToFile('error', ...)` 并保留旧文档（不触发白屏）。

---

## 第二部分：切换文档崩溃修复（P0）

### 现状（读码结论）

- 切换链路：`FileTree onSelect` → `openDocument` → `setMarkdown(content)` → MarkdownEditor effect → `editor.commands.setContent(markdownForEditor(...), { emitUpdate: false, contentType: 'markdown' })`。
- 该调用会全量重建 ProseMirror 文档与所有 node view：mermaid node view 每次 `setContent` 触发 `mermaid.render()`（异步、无取消、无并发限制）；代码块 node view 携带 DOM 工具条（运行按钮创建时捕获闭包变量）。
- 渲染进程崩溃（`render-process-gone`）无任何日志，无法判断是 `oom` / `crashed` / `killed`。

### 修复策略（日志先行、防御兜底、按日志追责）

1. 完成第一部分日志基建并记录 `render-process-gone` 的 `reason` 后，按 reason 定向修复：
   - `oom`：限制 mermaid 并发渲染队列（同一时间最多 N 个渲染任务，超出排队/跳过）；控制单次 `setContent` 的 mermaid 数量；必要时对超大文档惰性渲染
   - `crashed`：排查 GPU/开关；`in-process-gpu` 与 `sandbox:false` 组合在部分驱动下易崩溃，改为先去掉 `in-process-gpu` 再观察日志
   - `killed`/`abnormal-exit`：检查 `taskkill` 进程树逻辑、`MainWindow.reload()` 触发的重复加载
2. 无论 reason 如何均落实的防御性改动：
   - mermaid node view 增加 `destroy`：`renderVersion++` 使进行中的 `mermaid.render().then` 结果作废（当前已有 currentVersion 校验，补充 destroy 场景）；对 in-flight promise 不操作已分离的 DOM
   - `setContent` 包 try/catch：解析失败时保留旧文档、记录错误与 markdown 摘要（前 500 字符）
   - 文档切换时若存在未取消的代码块运行，统一 `cancelExecution`（现状只在 node view `destroy` 中处理，补充切换入口统一清理）
3. 修复验证：三连切换 10+ 个文档（含含 mermaid/表格/图片文档）无崩溃、日志中无 error 级记录、`render-process-gone` 不再触发。

---

## 第三部分：代码运行对话框（重构运行 UI）

### 目标

点击代码块「▶ 运行」→ 弹出**代码运行对话框**：代码自动复制进对话框的可编辑代码区，编辑后运行，**不影响文档内容**；结果只展示在对话框中。移除文档内嵌输出面板。

### 改动清单

**渲染层**

1. 新增 **`src/renderer/src/components/CodeRunnerDialog.tsx`**
   - Props：`open`、`initialLanguage`、`initialCode`、`documentPath`、`workingDirectory`、`onClose`、`onNotice`
   - 布局：
     - 头部：语言徽标 + 标题「代码运行」+ 关闭按钮
     - 代码编辑区：使用现有 `@codemirror` 栈（`src/renderer/src/components/SourceEditor.tsx` 已依赖 CodeMirror；复用其配置的最小版），带语言扩展、只读=false
     - 底部操作条：工作目录说明（截断显示）、「运行 (Ctrl+Enter)」/「终止」按钮
     - 结果区：状态徽标（成功/失败/超时/已终止）+ 耗时 + stdout/stderr（`pre` 等宽，中文正常）、max-height 滚动
   - 状态：`running`、`result`、`error`；运行中禁用编辑与重复运行
   - Dialog 打开时聚焦编辑器/或聚焦运行按钮（首 Tab）；Escape 关闭（运行中允许关闭并取消？——设计为：运行中关闭=终止运行并关闭）
2. **`src/renderer/src/components/MarkdownEditor.tsx`**
   - 代码块 node view 移除：`outputPanel` 全部逻辑（outputHeader/outputBody/statusBadge/durationBadge/collapseBtn/clearBtn/`has-output`）、`runCode` 内直接 executeCode 并操作 DOM 的整段逻辑
   - 「▶ 运行」按钮点击 → `onRunCodeRef.current(node)` → 通过 prop `onRunCode` 提升到 App
   - `destroy`：仅负责若该 node 正在运行则取消（对话框场景下运行归属对话框，故此处退化为安全兜底）
   - mermaid node view 增加 `destroy` 失效（见第二部分）
3. **`src/renderer/src/App.tsx`**
   - 新增 state：`runnerDialog: { language, code, documentPath, workingDirectory } | null`
   - `handleRunCode(language, code, workingDirectory)`：`setRunnerDialog({...})`
   - 渲染 `<CodeRunnerDialog>`，`onClose` 清空 state
   - `openDocument` 等切换入口：若对话框打开，先关闭对话框（或保持独立不联动——设计：切换文档时关闭对话框，避免工作目录/语境错乱）

**主进程**

- `runner:execute` 现有 handler 不变（`ExecutionRequest` 结构不变，已含 `documentPath`/`workingDirectory`）
- 无需新增 IPC

**样式**（`src/renderer/src/styles.css`）

- 新增 `.code-runner-dialog` 系列样式（对齐现有 modal-backdrop/dialog 体系）；删除 `.code-block-output*` 相关样式（`is-collapsed`、`has-output` 等），保留代码块工具条基础样式
- 结果区 stdout/stderr 色沿用现有 `code-output-stdout/stderr` 语义类名（可改名 `.runner-output-*`，UI 打磨阶段统一）

---

## 第四部分：Python 中文乱码

### 根因

`RunnerService.executeCode` 的 `spawn(finalCommand, { shell: true })` 下 Windows 使用 cmd.exe 启动 Python；Python 解释器 stdout 重定向（pipe）时采用系统 locale 编码（简体中文系统为 cp936/GBK），而主进程 `data.toString()` 默认按 UTF-8 解码 → 中文显示乱码。

### 修复（`src/main/runner-service.ts`）

1. **按语言注入 env**（首选方案）：
   - `python`：`env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }`
   - 实现：`executeCode` 中根据 `runner.language`（或 `request.language`）查 `LANGUAGE_ENV` 映射表，命中则合并进 `env`
   - 通用兜底：所有语言都保留 `LANG=C.UTF-8`（对部分工具链友好）
2. **解码兜底**（防御）：stdout/stderr `data` 收集改为累积 `Buffer`，`handleFinish` 时先按 UTF-8 `TextDecoder('utf-8', { fatal: false })` 解码；`win32` 下若结果含 `\uFFFD` 替换字符，整体按 `gbk` 重新解码（`iconv` 无依赖则用 Node 内置 `TextDecoder('gbk')`）
3. 验证：`print("中文测试：你好世界")`、`print("->", len("中文"))` 输出无乱码；含 Ctrl 字符/文件尾无后缀部分输出场景正常（`-u` 已保证实时输出到达）

---

## 第五部分：Windows 下 bash 执行策略

### 决策（已确认）

Git Bash 优先，缺失时 PowerShell 兼容执行。

### 实现（`src/main/runner-service.ts`）

1. 新增 `resolveBashInvocation()`：
   - win32 下依次探测：`where bash` → 常见安装路径（`C:\Program Files\Git\bin\bash.exe`、`C:\Program Files (x86)\Git\bin\bash.exe`、`%LOCALAPPDATA%\Programs\Git\bin\bash.exe`）→ `stat` 确认存在
   - 找到：bash 执行器命令保持 `bash "{file}"`
   - 未找到：返回 `powershell` 兼容执行方案（见下）
2. PowerShell 兼容执行：
   - 将 `.sh` 文件内容改写为 `.ps1`（同样写入临时目录），命令 `powershell -NoProfile -ExecutionPolicy Bypass -File "{ps1File}"`
   - 内容转换最小集：不做完整 sh→ps1 翻译（YAGNI）；仅提示——在 `ExecutionResult.stderr` 或新输出头附加说明「未检测到 Git Bash，已使用 PowerShell 兼容执行；部分 sh 语法可能不兼容」
   - 实现细节：不改 `settings-service.ts` 中 `DEFAULT_RUNNERS.bash` 的命令模板、不改用户存储的 settings.json；由 RunnerService 在执行时（`executeCode` 内部）判定：`process.platform === 'win32'` 且无 Git Bash 时，改走 powershell 分支（临时写 `.ps1` + `powershell -NoProfile -ExecutionPolicy Bypass -File`），否则维持原模板
3. `detectEnvironments()`：bash 检测结果标注 `path`（git-bash 路径）或 `available:false`+说明；设置面板（SettingsModal 运行商测试）自然受益

---

## 第六部分：MD 编辑体验对齐 Typora + UI 优化

### 输入即时渲染 / 渲染-编辑融合（`markdown-input-rules.ts` + `MarkdownEditor.tsx`）

现状核查：`markdown-input-rules.ts` 已覆盖标题（#~######）、无序/有序列表、引用、任务列表、代码块、行内加粗/斜体/删除线/高亮/行内代码。与 Typora 的差距主要在链接与图片的输入即转换。

决策（默认低复杂度路线，避免过度工程）：
- **链接**：保持快捷键/菜单 `Ctrl+K` 弹层输入（Typora 本就用快捷键为主）；不做 `[text](url)` 输入即转换（`@tiptap/markdown` 3.x input rule 对括号平衡语法支持有限，实现成本高收益低）
- **图片**：保持已支持的粘贴/拖拽插入（复用现有 `onDropImage`/`onSourceChange`）；不做输入即转换
- **其余打磨**：`---` 分隔线输入、行尾回车退出列表等细节核对补齐
- **WYSIWYG 质感**：标题/代码块/表格/引用的内联编辑态样式（斑马纹表格行、代码块焦点描边、图片选中态）——归入 UI 打磨

### 快捷操作体验

- 校对现有快捷键表与菜单命令一致性；补齐遗漏（如 `Ctrl+Shift+Z` 重做别名）
- 代码块/图片/链接选中态右键上下文菜单微调

### UI 整体优化（ui-ux-pro）

- 实现阶段载入 **ui-ux-pro** skill，对以下界面做设计审查与打磨（统一设计语言）：
  - 侧栏（文件树/大纲切换、空态）
  - 编辑器工具栏与代码块工具条
  - 状态栏
  - SettingsModal（runners 配置卡片、测试运行）
  - AiPanel
  - 新增 CodeRunnerDialog（与全局样式一致）
- 原则：不推倒重来，在现有 `styles.css` 结构上做增量优化，保持深色/浅色主题双向适配

---

## 范围与边界（不做的事）

- 不做完整 sh→ps1 语法翻译器
- 不做输入法/拼写检查改造
- 不引入新的日志第三方库（用 Node 内置 API）
- 不改变现有设置存储 schema（`settings.json` 的 runners 结构不变；bash 平台态在 RunnerService 内处理）
- 不重写编辑器内核（仍基于 TipTap + CodeMirror 现状）

## 实施顺序

1. **P0 日志基建**（logger.ts → main 接入 → preload → renderer 接入 → 埋点）
2. **P0 崩溃防御修复**（mermaid destroy、setContent try/catch、切换统一清理）
3. **代码运行对话框**（新组件 → MarkdownEditor 重构 → App 接线 → 移除内嵌输出面板 + 样式清理）
4. **Python 编码修复 + bash/PowerShell 策略**（runner-service 两处）
5. **Typora 对齐 + ui-ux-pro UI 打磨**

## 验证方式

- 单元测试：logger 轮转/回退（vitest，tmp 目录模拟只读失败）、encoding 解码兜底、bash 探测（mock win32/mac 分支）
- 手工验证：三连切换 10+ 文档无崩溃；运行 Python 中文输出正常；代码运行对话框编辑不影响文档；Windows 无 Git Bash 时 bash 脚本提示并兼容执行