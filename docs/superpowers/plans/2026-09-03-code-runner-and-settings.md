# 代码块执行引擎、浅色主题与统一设置中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现代码块默认浅色主题与语言徽章展示、支持代码就地执行与嵌入式输出区、新增统一设置中心（支持系统 PATH 环境变量检测与执行器配置，并将 AI 助手配置迁移至设置中心）。

**Architecture:** 主进程构建 `SettingsService`（持久化 settings.json 与 SafeStorage 凭据）与 `RunnerService`（PATH 环境变量扫描、子进程安全调度、15s 超时进程树强停与临时文件自清理）；渲染层重构代码块 NodeView（显示语言 Badge、运行/终止工具条与嵌入式输出栏）、开发统一 `SettingsModal` 并联动原生菜单【设置】（`Ctrl+,`）与主界面快捷入口。

**Tech Stack:** TypeScript, React, Electron, ProseMirror/TipTap, Node.js `child_process`, `tree-kill`/`taskkill`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-code-runner-and-settings-design.md`

## Global Constraints
- 代码块在浅色主题下必须采用现代淡灰底色 `#f6f8fa` 及 GitHub Light 配色，深色模式自适应切换。
- 代码执行必须以当前文档所在目录为默认工作目录（未保存文档回退至工作区根目录）。
- 代码执行超时时限为 15 秒，超时必须强杀子进程树，杜绝孤儿进程。
- 所有执行生成的临时脚本必须在 `finally` 中可靠删除。
- API Key 必须使用 Electron `safeStorage` 系统硬件级加密，禁止明文持久化在 JSON 中。

---

### Task 1: 扩展共享类型定义 (`types.ts`)

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: `RunnerDefinition`, `ExecutionRequest`, `ExecutionResult`, `AppSettings`, `DesktopApi.getSettings`, `DesktopApi.updateSettings`, `DesktopApi.detectEnvironments`, `DesktopApi.executeCode`, `DesktopApi.cancelExecution`

- [ ] **Step 1: 在 `src/shared/types.ts` 中补充执行器与设置类型**

```ts
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
```

- [ ] **Step 2: 扩展 `DesktopApi` 接口声明**

在 `DesktopApi` 中加入：
```ts
getSettings: () => Promise<AppSettings>
updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
detectEnvironments: () => Promise<Record<string, { available: boolean; path?: string; version?: string }>>
executeCode: (request: ExecutionRequest) => Promise<ExecutionResult>
cancelExecution: (executionId: string) => Promise<boolean>
```

- [ ] **Step 3: 运行类型检查验证**
Run: `npm run typecheck`
Expected: 检查通过或仅暴露未实现的 preload 方法。

- [ ] **Step 4: Git 提交**
```bash
git add src/shared/types.ts
git commit -m "feat(types): add runner definitions and app settings types"
```

---

### Task 2: 建立设置管理服务 (`SettingsService`)

**Files:**
- Create: `src/main/settings-service.ts`
- Create: `tests/settings-service.test.ts`

**Interfaces:**
- Produces: `SettingsService.getSettings()`, `SettingsService.updateSettings()`, `SettingsService.getSafeStorageKey()`, `SettingsService.setSafeStorageKey()`

- [ ] **Step 1: 编写 `SettingsService` 单元测试**

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsService } from '../src/main/settings-service'

describe('SettingsService', () => {
  it('initializes with default runners and persists changes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'md-settings-'))
    const service = new SettingsService(dir)
    const settings = await service.getSettings()

    expect(settings.runners.python).toBeDefined()
    expect(settings.runners.python.commandTemplate).toContain('python')
    expect(settings.runners.javascript).toBeDefined()

    await service.updateSettings({
      runners: {
        ...settings.runners,
        python: { ...settings.runners.python, commandTemplate: 'python3 -u "{file}"' }
      }
    })

    const updated = await service.getSettings()
    expect(updated.runners.python.commandTemplate).toBe('python3 -u "{file}"')

    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行测试验证失败**
Run: `npx vitest run tests/settings-service.test.ts`
Expected: FAIL，`SettingsService` 不存在。

- [ ] **Step 3: 实现 `SettingsService`**

创建 `src/main/settings-service.ts`，内置默认执行器字典（Python、JavaScript、TypeScript、PowerShell、Bash、Go、Rust、Java），实现 `userData/settings.json` 的读写与合并。

- [ ] **Step 4: 运行测试验证通过**
Run: `npx vitest run tests/settings-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Git 提交**
```bash
git add src/main/settings-service.ts tests/settings-service.test.ts
git commit -m "feat(main): implement SettingsService for persistent runners and ai configuration"
```

---

### Task 3: 建立代码执行器引擎 (`RunnerService`)

**Files:**
- Create: `src/main/runner-service.ts`
- Create: `tests/runner-service.test.ts`

**Interfaces:**
- Consumes: `SettingsService`, `RunnerDefinition`, `ExecutionRequest`, `ExecutionResult`
- Produces: `RunnerService.detectEnvironments()`, `RunnerService.executeCode()`, `RunnerService.cancel()`

- [ ] **Step 1: 编写 `RunnerService` 单元测试**

编写对环境探测解析、临时脚本执行输出（例如执行 node 计算 `1+1` 输出 `2`）、超时强杀、手动取消的测试用例。

- [ ] **Step 2: 运行测试验证失败**
Run: `npx vitest run tests/runner-service.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `RunnerService`**
- `detectEnvironments()`：跨平台探测（Windows 下 `where.exe`，类 Unix 下 `which`），执行 `--version` 提取版本；
- `executeCode(request, runner)`：
  1. 临时脚本目录 `path.join(os.tmpdir(), 'markdown-desk-runners')`；
  2. 写入带有正确扩展名的脚本文件；
  3. 计算 `cwd`（优先文件上级目录，回退工作区根目录）；
  4. 启动 `child_process.spawn`，绑定 15 秒超时器；
  5. 捕获 stdout 与 stderr（限幅 50,000 字符）；
  6. `finally` 中调用 `fs.rm` 清除脚本；
- `cancel(executionId)`：主动 kill 进程树。

- [ ] **Step 4: 运行测试验证通过**
Run: `npx vitest run tests/runner-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Git 提交**
```bash
git add src/main/runner-service.ts tests/runner-service.test.ts
git commit -m "feat(main): implement RunnerService with PATH detection, process timeout and tree-kill"
```

---

### Task 4: 主进程 IPC、原生菜单与 Preload 桥接

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces: IPC 通道 `settings:get`, `settings:update`, `runner:detect-env`, `runner:execute`, `runner:cancel`, 菜单项 `settings.open`

- [ ] **Step 1: 在 `src/main/menu.ts` 中加入【设置】菜单**
在【帮助】右侧新增一级菜单：
```ts
{
  label: '设置',
  submenu: [
    {
      label: '首选项...',
      accelerator: 'CmdOrCtrl+,',
      click: () => sendCommand(getWindow(), 'settings.open'),
    },
  ],
}
```

- [ ] **Step 2: 在 `src/main/index.ts` 中实例化并挂载 IPC**
注册 `settings:get`, `settings:update`, `runner:detect-env`, `runner:execute`, `runner:cancel`。

- [ ] **Step 3: 在 `src/preload/index.ts` 中暴露相关方法给渲染进程**

- [ ] **Step 4: 验证编译通过**
Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 5: Git 提交**
```bash
git add src/main/index.ts src/main/menu.ts src/preload/index.ts
git commit -m "feat(ipc): register settings and runner IPC channels with menu integration"
```

---

### Task 5: 代码块浅色外观与工具栏样式重构 (`styles.css`)

**Files:**
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Produces: `.tiptap-editor pre` 浅色主题、GitHub Light 语法高亮配色、`.code-block-header`、`.code-lang-badge`、`.code-run-btn`、`.code-output-panel` 样式

- [ ] **Step 1: 重构 `.tiptap-editor pre` 容器样式**
- 浅色模式下：背景 `#f6f8fa`，字体 `#24292f`，边框 `1px solid var(--border)`，行号颜色 `#8c959f`；
- 暗色模式（`[data-theme='dark'] .tiptap-editor pre`）：自适应深色背景 `#161b22`，行号 `#484f58`；
- 引入 GitHub Light 高对比高亮配色（关键字 `#cf222e`，字符串 `#0a3069`，函数 `#8250df` 等）。

- [ ] **Step 2: 增加语言标签、运行工具条与嵌入式输出区样式**
- 语言 Badge `.code-lang-badge`：精致圆角小胶囊；
- 运行按钮 `.code-run-btn`：支持运行动画与状态切换；
- 输出面板 `.code-output-panel`：包含状态栏（耗时、退出码、折叠按钮）与终端式输出内容区。

- [ ] **Step 3: 运行 lint 验证样式合法**
Run: `npm run lint`
Expected: PASS。

- [ ] **Step 4: Git 提交**
```bash
git add src/renderer/src/styles.css
git commit -m "feat(ui): redesign code blocks with light theme, language badges, and runner output styles"
```

---

### Task 6: 代码块 NodeView 增强（语言展示与运行集成）

**Files:**
- Modify: `src/renderer/src/components/MarkdownEditor.tsx`

**Interfaces:**
- Consumes: `window.desktop.executeCode`, `window.desktop.cancelExecution`, `window.desktop.getSettings`
- Produces: 交互式代码块，支持展示语言、点击运行/终止、展开嵌入式输出面板

- [ ] **Step 1: 在 `MarkdownEditor.tsx` 的代码块 NodeView 中增加工具栏结构**
- 左侧/右侧渲染 `.code-lang-badge`，自动解析 `node.attrs.language` 并格式化展示（例如 `python` -> `Python`，未指定展示 `Text`）；
- 渲染 `[▶ 运行]` 按钮与 `[📋 复制]` 按钮；
- 监听 `Ctrl+Enter` 快捷键，当焦点在代码块内时触发运行。

- [ ] **Step 2: 挂载嵌入式输出容器与状态控制**
- 在 `pre` 代码容器下方挂载输出容器；
- 点击运行后调用 `window.desktop.executeCode`，按钮切换为 `[⏹ 终止]`；
- 收到执行结果后展示耗时、退出码与 stdout/stderr；
- 提供“折叠输出”与“清空输出”功能。

- [ ] **Step 3: 运行自动化单元测试**
Run: `npm test`
Expected: PASS。

- [ ] **Step 4: Git 提交**
```bash
git add src/renderer/src/components/MarkdownEditor.tsx
git commit -m "feat(editor): enhance code block NodeView with language badge, run controls, and inline output"
```

---

### Task 7: 开发统一设置中心对话框 (`SettingsModal.tsx`)

**Files:**
- Create: `src/renderer/src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: `DesktopApi.getSettings`, `DesktopApi.updateSettings`, `DesktopApi.detectEnvironments`
- Produces: `<SettingsModal open={isOpen} initialTab={tab} onClose={...} onSettingsSaved={...} />`

- [ ] **Step 1: 构建 `SettingsModal.tsx` 骨架**
- 模态对话框遮罩与卡片，支持 `Esc` 键和外部点击关闭；
- 顶部导航 Tab：【代码执行器】与【AI 助手模型】。

- [ ] **Step 2: 实现【代码执行器】配置页**
- 顶部“从系统 PATH 自动检测”按钮；
- 遍历并展示主流语言卡片（Python、Node.js、TypeScript、PowerShell、Bash、Go、Rust、Java）；
- 显示探测状态徽章（`✅ 已找到` / `⚠️ 未检测到`）；
- 允许修改执行命令模板（如 `python -u "{file}"`）；
- 单击“测试运行”验证配置。

- [ ] **Step 3: 实现【AI 助手模型】配置页**
- 迁移原 AI 面板中的配置表单：Base URL、Model、API Key；
- 增加“测试连接”按钮；
- 保存时自动同步并提醒。

- [ ] **Step 4: 编译检查**
Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 5: Git 提交**
```bash
git add src/renderer/src/components/SettingsModal.tsx
git commit -m "feat(ui): create unified SettingsModal with runner PATH detection and AI model configuration"
```

---

### Task 8: 全局串联与 AI 面板精简

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/AiPanel.tsx`

**Interfaces:**
- Consumes: `SettingsModal`
- Produces: 菜单栏响应、顶部工具栏设置入口、AI 面板无缝直达设置

- [ ] **Step 1: 在 `src/renderer/src/App.tsx` 中挂载 `SettingsModal`**
- 增加 `settingsOpen` 与 `settingsTab` 状态；
- 在顶部标题栏右侧操作区加入 `[⚙️ 设置]` 按钮（悬浮提示：`设置 (Ctrl+,)`）；
- 监听原生菜单命令 `settings.open` 以及键盘快捷键 `Ctrl+,` 触发打开设置；
- 保存设置时更新全局状态并提示。

- [ ] **Step 2: 精简 `src/renderer/src/components/AiPanel.tsx`**
- 移除原狭窄侧栏内部冗长而折叠的表单；
- 点击 AI 面板齿轮按钮时触发 `onOpenSettings('ai')`，无缝打开全局设置中心的 AI 选项卡。

- [ ] **Step 3: 运行完整测试套件**
Run: `npm test`
Expected: 全部单元测试通过。

- [ ] **Step 4: Git 提交**
```bash
git add src/renderer/src/App.tsx src/renderer/src/components/AiPanel.tsx
git commit -m "feat(app): integrate SettingsModal, add toolbar button, and streamline AiPanel settings entry"
```

---

### Task 9: 端到端自动化验证与打包发布 (v0.3.0)

**Files:**
- Create: `tests/e2e/code-runner.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: 编写 E2E 测试 `tests/e2e/code-runner.spec.ts`**
- 验证代码块渲染语言 Badge（如 `python` 展示为 `Python`）；
- 验证浅色主题样式下代码块背景；
- 验证快捷键 `Ctrl+,` 呼出设置对话框；
- 验证执行器检测与代码运行操作。

- [ ] **Step 2: 执行全量自动化质量验证**
Run: `npm run typecheck && npm run lint && npm test && npx playwright test`
Expected: 0 警告、0 错误、所有单元与 E2E 测试全绿。

- [ ] **Step 3: 升级版本号至 0.3.0 并打包**
- `package.json` 版本升级为 `0.3.0`；
- 执行 `npm run dist:win` 构建 Windows 安装包与免安装便携版。

- [ ] **Step 4: Git 提交并打标签**
```bash
git add package.json tests/e2e/code-runner.spec.ts
git commit -m "release: v0.3.0 with code runner, light code block theme, and unified settings"
```
