# 代码块执行引擎、浅色主题与统一设置中心技术设计规约

- **日期**：2026-09-03
- **状态**：已批准设计 (Approved)
- **目标版本**：v0.3.0

---

## 1. 概述与需求背景

为了提升“墨笺”在技术写作、算法笔记与日常脚本调试场景下的实用性，用户提出以下五项核心功能需求：
1. **代码块默认浅色主题**：默认模式下采用现代桌面/GitHub 浅色代码容器与高对比语法高亮，深色模式自适应切换为暗色；
2. **代码块语言显示**：在代码块顶部工具栏醒目标记当前代码块所属的编程语言；
3. **代码就地执行与结果展示**：在代码块右上角增加运行与终止按钮，执行后在代码块正下方平滑展开嵌入式输出区（显示耗时、退出状态码、stdout/stderr，支持折叠与清空）；以当前文档所在目录作为工作目录，支持 15 秒超时保护与 Windows 进程树强停；
4. **统一设置中心对话框**：在菜单栏【帮助】右侧新增【设置】一级菜单，同时在界面顶部右上角提供快捷设置按钮，支持模态对话框展示；
5. **执行器环境变量识别与自定义配置**：设置中心提供“从系统 PATH 自动检测”功能，识别已安装语言并展示绝对路径与版本；支持自定义执行器命令模板；
6. **AI 模型配置迁移**：将原 AI 面板中的 Base URL、Model、API Key 等配置迁移至统一设置中心。

---

## 2. 架构与组件划分

### 2.1 主进程层 (Main Process)
- **`SettingsService` (`src/main/settings-service.ts`)**
  - 管理持久化配置（存储路径：%APPDATA%/markdown-desk/settings.json）；
  - 存储结构包含：
    - `runners: Record<string, RunnerDefinition>`：各编程语言的执行命令模板、扩展名、是否启用；
    - `ai: AiSettings`：Base URL、Model 等通用设置（API Key 继续由系统的 SafeStorage 加密存储）；
  - 具备开箱即用的默认主流语言模板与配置合并自愈机制。
- **`RunnerService` (`src/main/runner-service.ts`)**
  - **环境变量检测**：通过平台适配命令（Windows 下调用 `where.exe <cmd>`、macOS/Linux 下调用 `which <cmd>`）扫描系统 PATH 环境变量，自动探测 Python、Node.js、TypeScript、Bash/PowerShell、Go、Rust、Java 等环境并提取版本信息；
  - **脚本执行生命周期管理**：
    - 将待执行代码写入系统临时安全目录下的特定扩展名脚本（如 `.py`、`.js`、`.go` 等），避免命令行长度与字符转义隐患；
    - 解析当前文件所在目录作为 `cwd`（若未保存文档则回退到工作区根目录）；
    - 使用 `child_process.spawn` 启动独立进程；
    - 运行 15 秒超时计时器，若超时使用 Windows 进程树清理 (`taskkill /pid <PID> /T /F`) 终止进程并报告 `timedOut: true`；
    - 支持通过 `executionId` 随时人工中断运行；
    - 收集 `stdout` 与 `stderr`（截断保护最大 50,000 字符），退出后自动彻底清除临时脚本文件。
- **IPC 通信注册 (`src/main/index.ts`)**
  - `settings:get`：获取全量设置；
  - `settings:update`：持久化更新设置；
  - `runner:detect-env`：触发全量扫描系统已安装语言；
  - `runner:execute`：启动代码执行；
  - `runner:cancel`：中断指定执行中的任务；
  - `menu.ts`：在【帮助】右侧新增【设置】一级菜单，快捷键 `Ctrl+,`，向渲染进程发送 `settings.open` 指令。

### 2.2 渲染进程层 (Renderer Process)
- **`SettingsModal` (`src/renderer/src/components/SettingsModal.tsx`) [NEW]**
  - 现代化模态对话框，支持 `Esc` 或外部点击退出；
  - 左侧/顶部 Tab 导航：
    - **Tab 1: 代码执行器**：提供“从系统 PATH 自动检测”按钮、语言卡片列表、环境检测状态标签、执行命令模板编辑、快速运行测试按钮；
    - **Tab 2: AI 模型设置**：迁移并整合原 AI 面板表单，提供 Base URL、Model、API Key（加密存储）、连通性测试按钮。
- **`MarkdownEditor` 扩展 (`src/renderer/src/components/MarkdownEditor.tsx`)**
  - 重构代码块 NodeView：
    - 顶部工具栏：
      - **语言标签**（如 `Python`、`JavaScript`、`Go`，未指明时显示 `Text`）；
      - **运行控制**：未运行时显示 `[▶ 运行 (Ctrl+Enter)]`，运行时显示 `[⏹ 终止 (运行中...)]`；
      - **复制控制**：`[📋 复制]` 按钮；
    - 底部嵌入式输出区：
      - 状态徽章（`成功 0` / `失败 1` / `超时 15s`）；
      - 执行耗时（如 `85ms`）；
      - `stdout`（标准终端色）与 `stderr`（柔和淡红警告色）；
      - 输出控制：`[折叠/展开]` 与 `[清空]`。
- **`AiPanel` 调整 (`src/renderer/src/components/AiPanel.tsx`)**
  - 移除原狭窄折叠面板中的繁琐配置表单，原设置按钮改为直接调用 `onOpenSettings('ai')` 呼出全局设置对话框并定位到 AI 选项卡。
- **全局状态与工具栏联动 (`src/renderer/src/App.tsx`)**
  - 监听 `settings.open` 菜单事件；
  - 顶部导航右上角新增 `[⚙️ 设置]` 快捷图标按钮；
  - 挂载 `<SettingsModal />` 并管理显示隐藏状态。

### 2.3 样式系统 (`src/renderer/src/styles.css`)
- **浅色代码块重构**：
  - 默认浅色容器背景为 `#f6f8fa`（浅灰润白），边框 `1px solid var(--border)`，圆角 `8px`；
  - 行号颜色 `#8c959f`，分隔线清晰雅致；
  - 引入高对比 GitHub Light 浅色语法高亮配色方案；
  - 深色模式（`[data-theme='dark']`）自动平滑映射至暗黑高亮配色；
- **执行工具条与输出区**：
  - 代码块工具栏浮层样式 `.code-block-toolbar`；
  - 嵌入式输出面板样式 `.code-block-output`（等宽字体、滚动条优化、错误堆栈样式）。

---

## 3. 详细数据结构与接口契约

### 3.1 类型定义 (`src/shared/types.ts`)
```ts
export type RunnerDefinition = {
  id: string
  name: string
  language: string          // 匹配代码块的语言标注，如 'python', 'javascript', 'bash'
  extension: string         // 临时文件后缀名，如 '.py', '.js', '.sh'
  commandTemplate: string   // 命令模板，如 'python -u "{file}"'
  enabled: boolean
  detectedPath?: string     // 自动从 PATH 探测到的绝对路径
  detectedVersion?: string  // 自动检测到的版本信息
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
```

### 3.2 默认预设执行器
| 语言 Key | 显示名称 | 匹配别名 | 后缀名 | 默认命令模板 |
| :--- | :--- | :--- | :--- | :--- |
| `python` | Python | `python`, `py` | `.py` | `python -u "{file}"` |
| `javascript` | JavaScript (Node.js) | `javascript`, `js`, `node` | `.js` | `node "{file}"` |
| `typescript` | TypeScript | `typescript`, `ts` | `.ts` | `npx tsx "{file}"` |
| `powershell` | PowerShell | `powershell`, `ps1` | `.ps1` | `powershell -ExecutionPolicy Bypass -File "{file}"` |
| `bash` | Bash / Shell | `bash`, `sh`, `shell` | `.sh` | `bash "{file}"` |
| `go` | Go | `go`, `golang` | `.go` | `go run "{file}"` |
| `rust` | Rust | `rust`, `rs` | `.rs` | `rustc "{file}" -o "{bin}" && "{bin}"` |
| `java` | Java | `java` | `.java` | `java "{file}"` |

---

## 4. 边界情况与安全控制

1. **死循环与资源耗尽**：
   - 超时强制定时器（15,000ms），超时触发 Windows 进程树清理 (`taskkill /pid <PID> /T /F`)，确保孤儿子进程一并销毁；
   - 输出字符限制在 50,000 字符以内，防止海量标准输出卡顿渲染进程。
2. **工作目录智能判定**：
   - 优先以当前保存的文档目录为工作目录；
   - 若当前为新建未落盘文档，自动回退到当前工作区根目录，再回退到用户主目录。
3. **临时文件清理保障**：
   - 无论执行成功、报错、超时还是用户手动点击终止，均在 `finally` 中严格执行清理逻辑，不留任何垃圾文件。
4. **API Key 安全保护**：
   - API 密钥不以明文保存在 `settings.json` 中，继续采用系统级安全凭据存储服务（Electron SafeStorage / Windows DPAPI），保证高安全性。

---

## 5. 验证与测试策略

1. **单元测试 (Unit Tests)**：
   - `tests/runner-service.test.ts`：测试环境扫描逻辑、临时脚本生成与清理、Python/Node.js 快速执行结果解析、超时中断机制；
   - `tests/settings-service.test.ts`：测试默认配置初始化、更新合并与数据持久化；
2. **端到端自动化测试 (E2E Tests)**：
   - `tests/e2e/code-runner.spec.ts`：验证代码块语言标签渲染、浅色主题样式变量、点击运行按钮输出预期结果、设置对话框打开与保存；
3. **手工验证**：
   - 打开包含 Python 代码块的文档，点击运行，观察下方输出区平滑展开并显示正确计算结果；
   - 在设置中修改 Python 路径为无效值，再次运行验证友好错误提示；
   - 点击“从系统 PATH 自动检测”，验证环境状态徽章更新正确。
