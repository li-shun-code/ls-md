# Mojian — AI Markdown Studio

<div align="center">

**现代化双引擎 AI Markdown 编辑器 · 专为高效写作与知识管理打造**

[![GitHub Release](https://img.shields.io/github/v/release/li-shun-code/mojian?style=flat-square&color=blue)](https://github.com/li-shun-code/mojian/releases)
[![Build & Release](https://img.shields.io/github/actions/workflow/status/li-shun-code/mojian/build.yml?branch=main&style=flat-square)](https://github.com/li-shun-code/mojian/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey?style=flat-square)]()

</div>

---

## ✨ 核心特性

- ✍️ **所见即所得 & 源码双模式**：基于现代富文本核心与 Markdown 引擎，毫秒级无缝切换。
- 🤖 **内置 AI 创作助手**：
  - 支持 **问答、润色、扩写、精简、翻译、校对、续写、摘要** 等多种 AI 操作。
  - 支持智能选取文档片段进行上下文对话，并在回答中精准定位引用段落与行跳转。
  - 自定义 API 接入（支持 OpenAI 规范兼容接口及模型配置）。
- 📊 **强大的富文本与图表支持**：
  - **Mermaid 流程图 / 时序图 / 类图**：实时渲染，支持全屏预览、缩放平移、导出与复制 SVG 源码。
  - **KaTeX 数学公式**：支持行内及独立块级数学公式渲染。
  - **代码高亮与行号**：支持主流编程语言语法高亮及一键复制代码。
  - **交互式表格**：支持右键菜单插入行、插入列、格式化表格。
  - **任务清单与多级标题**：轻松组织任务与思维导图式内容。
- 📂 **工作区与文件管理**：
  - 目录树多级浏览，一键切换工作区。
  - 实时提取文档大纲（Outline），点击标题平滑定位。
  - 应用菜单内置“**打开最近文件**”浮动二级子菜单（保留最近 20 条记录，支持一键清空）。
  - **意外恢复与草稿保护**：毫秒级自动快照，防止断电或意外退出导致的内容丢失。
- 📄 **多格式导出与打印**：
  - 支持导出排版精美的 **HTML**。
  - 支持直接生成高清 **PDF** 及系统原生打印。
- 🎨 **舒适的设计与交互**：
  - 专注模式（Focus Mode）：隐藏干扰元素，沉浸于写作。
  - 深色模式（Dark Mode）与浅色模式无缝切换。
  - 兼容 Typora / 经典编辑器的常用快捷键体系。

---

## ⌨️ 常用快捷键

| 操作 | 快捷键 | 操作 | 快捷键 |
| :--- | :--- | :--- | :--- |
| **保存** | `Ctrl + S` | **另存为** | `Ctrl + Shift + S` |
| **新建文档** | `Ctrl + N` | **打开工作区** | `Ctrl + Shift + O` |
| **切换源码模式** | `Ctrl + /` | **搜索文本** | `Ctrl + F` |
| **显示/隐藏侧栏** | `Ctrl + Shift + L` | **专注模式** | `Ctrl + Shift + F` |
| **一级 ~ 六级标题**| `Ctrl + 1 ~ 6` | **正文段落** | `Ctrl + 0` |
| **加粗** | `Ctrl + B` | **斜体** | `Ctrl + I` |
| **删除线** | `Ctrl + Shift + X` | **行内代码** | `Ctrl + Shift + \`` |
| **插入链接** | `Ctrl + K` | **代码块** | `Ctrl + Shift + K` |
| **无序列表** | `Ctrl + Shift + 8` | **有序列表** | `Ctrl + Shift + 7` |
| **任务列表** | `Ctrl + Shift + 9` | **引用块** | `Ctrl + Shift + Q` |
| **放大 / 缩小** | `Ctrl + + / -` | **打印** | `Ctrl + P` |

---

## 🛠️ 技术栈

- **框架内核**：[Electron 38](https://www.electronjs.org/) + [React 19](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/)
- **构建工具**：[electron-vite](https://electron-vite.org/) + [Vite 6](https://vitejs.dev/)
- **富文本引擎**：[Tiptap 3](https://tiptap.dev/) + [CodeMirror / Lowlight](https://highlightjs.org/)
- **图表与公式**：[Mermaid](https://mermaid.js.org/) + [KaTeX](https://katex.org/)
- **测试体系**：[Vitest](https://vitest.dev/) (单元测试) + [Playwright](https://playwright.dev/) (端到端 E2E 测试)
- **CI / CD**：GitHub Actions 自动化多平台矩阵打包（Windows & macOS）

---

## 🚀 本地开发与调试

### 环境要求
- Node.js >= 20.0.0
- npm >= 10.0.0

### 安装与运行
```bash
# 1. 克隆仓库
git clone git@github.com:li-shun-code/mojian.git
cd mojian

# 2. 安装依赖
npm install

# 3. 启动本地开发环境 (支持热重载)
npm run dev
```

### 运行测试与校验
```bash
# 执行单元测试
npm test

# 执行端到端 E2E 自动化测试
npm run test:e2e

# 执行代码风格与语法检查
npm run lint

# 执行 TypeScript 类型校验
npm run typecheck
```

---

## 📦 打包与分发

项目配置了完整的本地打包与 GitHub Actions 自动化云打包支持：

### 1. 本地打包
```bash
# 打包 Windows 安装包 (NSIS 安装程序与绿色免安装版)
npm run dist:win

# 打包 macOS 安装包 (DMG 与 ZIP 格式，需在 macOS 环境执行)
npm run dist:mac
```
构建产物将输出在 `release/` 目录下。

### 2. GitHub Actions 自动化打包
- 每次提交或创建 Pull Request 时，GitHub Actions 会自动进行跨平台构建与测试。
- 推送版本标签（例如 `v0.2.0`）即可自动触发云端多平台编译并在 [Releases](https://github.com/li-shun-code/mojian/releases) 页面发布最新的安装程序。

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。
