# 自定义文档主题规范

Mojian 内置 GitHub、Gothic、Newsprint、Night、Pixyll、Whitey 六种 Typora 经典主题风格，切换时同时更新文档区域和应用界面的配色。自定义主题是一个 `.css` 文件；导入后以文件名作为主题名称，保存在本机应用数据目录并由所有文档共用。自定义 CSS 仅作用于可视化 Markdown 文档区域及 HTML、PDF、Word 导出。

## 样式作用域

导入的 CSS 会在 `.mojian-document` 作用域内生效。CSS 文件中使用 `:scope` 指代文档区域根节点，使用 `:scope h1`、`:scope p` 等选择器设置文档元素。侧栏、设置、源码编辑器和系统标题栏不受自定义 CSS 影响。

不要编写 `body`、`:root`、`.app-shell` 等全局选择器。Mojian 不会直接应用 Typora 旧版主题中面向 `body` 或 `#write` 的全局 CSS；需要按本规范调整选择器。

## 示例

```css
:scope {
  color: #26312b;
  background-color: #f4f1e8;
  font-family: Georgia, "Songti SC", serif;
  font-size: 16px;
  line-height: 1.8;
}

:scope h1,
:scope h2 {
  color: #233f32;
  border-bottom: 1px solid #d6d1c4;
}

:scope a {
  color: #3f745d;
}

:scope blockquote {
  border-left: 3px solid #a67a45;
  padding-left: 1em;
}

:scope pre,
:scope code {
  font-family: "Cascadia Code", Consolas, monospace;
}
```

## 可用内容与限制

- 可通过 `:scope` 及其后代选择器设置标题、段落、列表、引用、代码、表格、链接、图片、公式和流程图的样式。
- CSS 文件不超过 512 KB。字体请使用系统已安装的字体；主题不能加载 `@import` 或 `url()` 外部资源。
- 不支持 JavaScript，也不要使用会覆盖 Mojian 应用窗口控件的全局选择器。
- Word 以文档格式支持的颜色、字体、间距、边框和对齐方式呈现主题；网页特有的伪元素、阴影等效果可能无法映射到 Word。

## 导入

在“设置 → 主题”顶部查看本规范，然后选择“导入 CSS 主题…”。导入后，主题会出现在主题列表中；选择主题会立即应用，并在下次启动时保留。
