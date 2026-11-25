import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

type CrashEntry = { reason: string; exitCode: number; pid: number }

function docContent(title: string): string {
  return `# ${title}

这是一份用于复现「文件树切换文档崩溃」的示例文档。

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{判断}
  B -->|是| C[处理]
  B -->|否| D[结束]
  C --> D
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant U as 用户
  participant S as 服务端
  U->>S: 请求
  S-->>U: 响应
\`\`\`

## 代码

\`\`\`python
def hello(name: str) -> str:
    return f"你好，{name}"

print(hello("墨笺"))
\`\`\`

\`\`\`javascript
const items = [1, 2, 3].map((n) => n * 2)
console.log(items.join(', '))
\`\`\`

## 表格

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 编辑器 | 正常 | 所见即所得 |
| 渲染 | 正常 | Mermaid / KaTeX |

## 数学公式

$$
E = mc^2
$$

行内公式 $x^2 + y^2 = z^2$。

## 图片

![示例图片](./assets/${title}.png)

## 正文

列表项：

- 第一项
- 第二项
  - 嵌套项
- 第三项

> 引用内容：切换文档不应导致编辑窗口异常中断。

1. 有序一
2. 有序二

**加粗**、*斜体*、~~删除线~~ 与 \`行内代码\`。

水平分割线：

---

（结尾段落，${title}）`
}

// 统计目录下全部 md 文件（跳过构建产物目录）
async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.markdown-desk') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (/\.(md|markdown|mdown|mkd)$/i.test(entry.name)) out.push(full)
    }
  }
  await walk(root)
  out.sort((a, b) => a.localeCompare(b))
  return out
}

test('switch documents in file tree rapidly without renderer crash', async () => {
  // 环境变量 E2E_REAL_WORKSPACE 指向真实目录时使用真实文档复现
  const realWorkspace = process.env.E2E_REAL_WORKSPACE
  let root: string
  let files: string[]
  let userDataPath: string

  if (realWorkspace) {
    root = realWorkspace
    const all = await collectMarkdownFiles(root)
    const sizes = await Promise.all(all.map(async (file) => ({ file, size: (await stat(file)).size })))
    // 取最大的 8 份文档作为切换对象
    files = sizes.sort((a, b) => b.size - a.size).slice(0, 8).map((item) => item.file)
    userDataPath = await mkdtemp(path.join(os.tmpdir(), 'md-desk-switch-ud-'))
  } else {
    root = await mkdtemp(path.join(os.tmpdir(), 'md-desk-switch-'))
    userDataPath = await mkdtemp(path.join(os.tmpdir(), 'md-desk-switch-ud-'))
    files = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']
    for (const file of files) {
      await writeFile(path.join(root, file), docContent(file), 'utf8')
    }
  }

  try {
    const app = await electron.launch({
      // 可指定打包后的可执行文件（如旧版 v0.3.0）验证其是否崩溃
      executablePath: process.env.E2E_EXECUTABLE_PATH || undefined,
      args: [`--user-data-dir=${userDataPath}`, path.resolve('.')],
    })
    try {
      const page = await app.firstWindow()
      await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
      // 自动接受未保存修改的确认对话框（模拟用户点击「确定」）
      page.on('dialog', (dialog) => { void dialog.accept() })

      // 预先挂载崩溃 / 无响应证据收集器（存于主进程侧）
      await app.evaluate(({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0]?.webContents
        const store = { crashes: [] as CrashEntry[], unresponsive: 0 }
        ;(globalThis as unknown as { __health: typeof store }).__health = store
        if (!wc) return
        wc.on('render-process-gone', (_event, details) => {
          store.crashes.push({ reason: details.reason, exitCode: details.exitCode, pid: details.pid })
        })
        wc.on('unresponsive', () => { store.unresponsive += 1 })
      })

      // 模拟主进程推送工作区文件树（与真实“打开工作区”同路径）
      const tree = files.map((name) => ({
        kind: 'file' as const,
        name: path.basename(name),
        path: name,
        children: [] as never[],
      }))
      await app.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('workspace-selected', payload)
      }, { root, tree })

      // 侧栏默认在大纲页，先切到「文件」标签
      await page.getByRole('tab', { name: '文件' }).click()
      await expect(page.getByRole('tree', { name: '工作区文件' })).toBeVisible()

      const health = () =>
        app.evaluate(() => (globalThis as unknown as { __health: { crashes: CrashEntry[]; unresponsive: number } }).__health)

      // 像真实用户一样在文件树中快速连续点选切换文档（不等渲染完成，覆盖渲染中切换场景）
      // 每次切换前先输入内容制造「未保存修改」，触发 window.confirm 同步原生对话框
      let switched = 0
      for (let round = 0; round < 3; round += 1) {
        for (const file of files) {
          await page.locator('.tiptap-editor').click()
          await page.keyboard.type('x', { delay: 5 })
          await page.locator('.tree-row').filter({ hasText: path.basename(file) }).click()
          switched += 1
          if (switched % 5 === 0) {
            const state = await health()
            expect(state.crashes, `第 ${switched} 次切换后渲染进程崩溃：${JSON.stringify(state.crashes)}`).toEqual([])
            expect(state.unresponsive).toBe(0)
          }
        }
      }

      // 最后一次切换后等待内容稳定，再核对页面可交互
      await page.locator('.tree-row').filter({ hasText: path.basename(files[0]) }).click()
      await expect(page.locator('.tiptap-editor h1').first()).toBeVisible()
      const finalState = await health()
      expect(finalState.crashes, `崩溃明细：${JSON.stringify(finalState.crashes)}`).toEqual([])
      await expect(page.locator('.tiptap-editor')).toBeVisible()
    } finally {
      await app.close().catch(() => undefined)
    }
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
    if (!realWorkspace) await rm(root, { recursive: true, force: true })
  }
})