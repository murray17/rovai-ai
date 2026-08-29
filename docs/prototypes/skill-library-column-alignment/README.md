# Skill 列表表头对齐交互稿

这份原型内嵌生产 Renderer 的 `styles.css`，并复用 Settings 壳层类名与 Skill 行组件类名。
它可以作为 Camp 单文件附件直接打开，只验证“Skill / 生效范围 / 状态 / 查看”四个可见表头
与行内容的共同轨道，不连接 Core，也不会修改真实 Skill。最左侧身份标记位和 MCP 页一致，
保留为空白结构位；`Skill` 标注其后的名称与简介列。

在项目根目录运行：

```bash
python3 -m http.server 4188 --bind 127.0.0.1 --directory .
```

然后访问：

`http://127.0.0.1:4188/docs/prototypes/skill-library-column-alignment/`

在地址末尾加 `?theme=night` 可核对 Steel Night；不加参数时使用 Porcelain Day。

生产 `styles.css` 变化后，运行以下命令重新内嵌样式：

```bash
node docs/prototypes/skill-library-column-alignment/bundle.mjs
```

可交互内容：

- 搜索 Skill；
- 展开与关闭“添加 Skill”面板；
- 打开生效范围菜单并连续多选；
- 切换启用状态；
- 展开与收起来源详情；
- 使用键盘操作搜索、菜单、Switch 与详情按钮。

原型的 Skill 内容是说明性样例；布局、文案层级、主题 Token 与控件样式取自当前生产页面。
设计结论见 [`design-brief.md`](./design-brief.md)。
