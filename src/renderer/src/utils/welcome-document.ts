export const WELCOME_DOCUMENT_MARKDOWN = `# 欢迎使用墨笺 (ls-md) · 平台全功能指南

> **墨笺** 是一款现代化、面向桌面端深度优化的 **双引擎 AI Markdown 编辑器**。
> 无论您是进行日常技术写作、知识库整理、流程图绘制，还是借助 AI 辅助创作，墨笺都能为您提供极致丝滑的写作体验。

---

## 🚀 核心模式切换

- **所见即所得模式**：默认所见即所得，排版效果实时呈现，打字即排版。
- **Markdown 源码模式**：随时按下快捷键 \`Ctrl + /\`，毫秒级切换到底层标准 Markdown 源码进行精细调整。

---

## ✍️ 基础文本排版与样式

墨笺支持丰富且标准的一级至六级标题与行内文本样式：

### 文本修饰示例
- **加粗文本**：使用 \`**加粗内容**\` 或按下 \`Ctrl + B\`
- *斜体强调*：使用 \`*斜体内容*\` 或按下 \`Ctrl + I\`
- ~~删除线~~：使用 \`~~删除线~~\` 或按下 \`Ctrl + Shift + X\`
- \`行内代码\`：使用反引号包裹 \`code\` 或按下 \`Ctrl + Shift + \`\`
- ==高亮重点==：用于标注文档中的核心关键信息
- [墨笺官方仓库链接](https://github.com/li-shun-code/ls-md)：按 \`Ctrl + K\` 快速插入超链接

### 引用与分割线
> **写作箴言**：工欲善其事，必先利其器。清晰的排版让思考更加聚焦。
> —— 墨笺设计团队

---

## ☑️ 交互式任务清单 (Task Lists)

按 \`Ctrl + Shift + 9\` 可快速插入任务列表，支持直接点击勾选：

- [x] 搭建跨平台 Electron + React 19 现代化技术底座
- [x] 实现毫秒级平滑的双模式 Markdown 编辑引擎
- [x] 集成 Mermaid 图表与 KaTeX 复杂数学公式渲染
- [x] 支持高清图片化大图预览与多格式导出 (PNG / SVG / JPEG)
- [ ] 开启您的第一篇 Markdown 知识创作之旅

---

## 📊 交互式表格 (Tables)

在编辑器中可随时插入表格，在表格单元格上**点击鼠标右键**即可唤出专属菜单，支持一键【上方插入行】、【下方插入行】、【左侧插入列】、【右侧插入列】以及【删除行列】：

| 功能模块 | 支持特性 | 快捷键 / 操作 | 状态 |
| :--- | :--- | :--- | :---: |
| **文档大纲** | 自动提取 H1~H6 实时跳转 | 侧栏“大纲”标签页 | ✅ 完善 |
| **最近文件** | 顶部文件菜单二级悬浮展示（上限20条） | 文件 -> 打开最近文件 | ✅ 完善 |
| **图表预览** | 2.5x 高清图片光栅化 + 无限平移漫游 | 点击任意流程图 | ✅ 完善 |
| **格式导出** | 支持 PNG、SVG、JPEG 一键导出 | 预览弹窗【下载 ▾】 | ✅ 完善 |
| **AI 创作助手** | 润色、翻译、扩写、精简、上下文跳转 | 右下角 ✨ 图标 | ✅ 完善 |

---

## 💻 语法高亮代码块

支持数十种主流编程语言语法高亮、行号展示以及右上角一键复制代码：

\`\`\`typescript
// TypeScript 代码块高亮与类型提示示范
interface MarkdownDocument {
  id: string;
  title: string;
  wordCount: number;
  tags: string[];
}

export function analyzeDocument(doc: MarkdownDocument): string {
  console.log(\`正在分析文档: \${doc.title} (\${doc.wordCount} 字)\`);
  return \`已成功加载 \${doc.tags.join(', ')}\`;
}
\`\`\`

\`\`\`python
# Python 算法示例
def fibonacci(n: int) -> list[int]:
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence[:n]

print("斐波那契数列前 8 项:", fibonacci(8))
\`\`\`

---

## 🧜‍♂️ Mermaid 流程图与架构图 (点击可查看高清大图并下载)

墨笺内置强劲的 Mermaid 引擎。**直接点击下方任意图表**，即可开启**高清大图预览**，支持 **60 FPS 丝滑拖拽平移、滚轮缩放**，并通过右上角 **【下载 ▾】** 保存为 **PNG / SVG / JPEG**！

### 1. 业务交互流程图
\`\`\`mermaid
graph TD
  Start([🚀 启动墨笺]) --> OpenFile[打开 Markdown 文件 / 工作区]
  OpenFile --> EditMode{选择编辑模式}
  EditMode -->|所见即所得| WYSIWYG[实时富文本排版编辑]
  EditMode -->|源码模式| Source[高精源码直接编写]
  WYSIWYG --> AI[🤖 唤起 AI 辅助创作]
  Source --> AI
  AI --> Export[📄 导出 HTML / PDF / 打印]
  Export --> End([✨ 创作完成])
\`\`\`

### 2. 系统时序交互图
\`\`\`mermaid
sequenceDiagram
  autonumber
  actor User as 创作者
  participant Editor as 墨笺编辑器
  participant AI as AI 助手引擎
  participant Exporter as 导出引擎

  User->>Editor: 选中重点段落并请求润色
  Editor->>AI: 发送段落上下文与提示词
  AI-->>Editor: 流式返回润色建议与引用锚点
  Editor->>User: 实时高亮呈现并一键采纳
  User->>Exporter: 点击导出为 PDF / HTML
  Exporter-->>User: 生成高保真排版文档
\`\`\`

### 3. 数据分布饼图
\`\`\`mermaid
pie title 文档构成类型分布
  "技术架构与文档" : 45
  "AI 提示词与知识库" : 25
  "日常会议纪要" : 18
  "待办与敏捷规划" : 12
\`\`\`

---

## 📐 KaTeX 复杂数学公式

无论是行内公式还是独立块级公式，均可精准呈现：

### 行内公式
爱因斯坦质能方程：$E = mc^2$，欧拉恒等式：$e^{i\\pi} + 1 = 0$。

### 独立矩阵与微积分公式
$$
\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

$$
\\begin{pmatrix}
\\cos\\theta & -\\sin\\theta \\\\
\\sin\\theta & \\cos\\theta
\\end{pmatrix}
\\begin{pmatrix}
x \\\\
y
\\end{pmatrix}
=
\\begin{pmatrix}
x' \\\\
y'
\\end{pmatrix}
$$

---

## 🤖 AI 智能创作面板

点击编辑器底部状态栏右下角的 **✨ AI 助手** 图标，即可开启右侧智能面板：
1. **智能问答**：基于当前打开的文档内容，快速提问与检索知识。
2. **文本精修**：一键进行【学术润色】、【通俗化改写】、【错别字校对】、【要点总结】。
3. **内容扩写与续写**：根据已有大纲逻辑，激发灵感并自动续写后续篇章。
4. **引用溯源**：AI 回答中包含的段落引用标签，点击可瞬间跳转至编辑器对应行！

---

## 🖨️ 导出与分享

- **导出为 HTML**：文件 -> 导出为 HTML，生成自包含样式、公式与排版的网页文件。
- **导出为 PDF**：文件 -> 导出为 PDF，生成标准 A4 高清打印级文档。
- **系统打印**：按 \`Ctrl + P\` 直接调用系统打印机。

---

## ⌨️ 常用快捷键一览

| 快捷键 | 功能 | 快捷键 | 功能 |
| :--- | :--- | :--- | :--- |
| \`Ctrl + S\` | 保存文档 | \`Ctrl + Shift + S\` | 另存为… |
| \`Ctrl + N\` | 新建空白文档 | \`Ctrl + Shift + O\` | 打开文件夹工作区 |
| \`Ctrl + /\` | 切换源码/所见即所得 | \`Ctrl + F\` | 页面内快速查找 |
| \`Ctrl + Shift + L\` | 显示/隐藏左侧导航栏 | \`Ctrl + Shift + F\` | 进入/退出专注模式 |
| \`Ctrl + 1 ~ 6\` | 设置对应级别标题 | \`Ctrl + 0\` | 恢复为正文段落 |
| \`Ctrl + B\` | 加粗选中文本 | \`Ctrl + I\` | 斜体选中文本 |
| \`Ctrl + Shift + K\` | 插入多语言代码块 | \`Ctrl + Shift + Q\` | 插入引用块 |
| \`Ctrl + +\` / \`Ctrl + -\` | 放大 / 缩小界面视图 | \`Ctrl + P\` | 打印当前文档 |

---

感谢您使用 **墨笺**，祝您创作愉快！如需随时再次查看本文档，可点击顶部菜单栏 **【帮助】 -> 【功能介绍与示例文档】**。
`
