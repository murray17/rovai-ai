# 执行台内 Command View · Steel 底色方向稿

入口：[index.html](./index.html)

这是一个用于选择视觉方向的单文件静态稿，不连接 Core、IPC、真实 AgentRun 或 Runtime。页面中的
队员、命令、模型、状态和输出均为合成样例，不代表产品事实。

## 当前格式基线

方向稿已同步当前工作区的 v25 Shell command detail 合同：展开内容是单一连续 `<pre>`，第一行严格为
`$ command`，有输出时从第二行立即开始。没有“命令 / 输出”标签、空白分隔行或内部装饰 DOM。
预览中的 “Command View / Steel Mist” 只用于标注方案，不属于生产 DOM 或产品文案。

## 可选方向

- **A · Steel Air**：在现状上明显抬亮，但仍最接近原 Evidence 层级；最克制。
- **B · Steel Mist（建议首选）**：参考用户截图改为低饱和中性浅灰，文字同步收柔，弱化蓝钢感。
- **C · Steel Frost**：三案中最亮、独立面板感最强；用于判断更激进的亮度上限。

三套方向共用同一执行台、Run 卡、时间轴与 Tool 行，并同时提供 Porcelain Day / Steel Night
切换。方向开关只改变展开 Tool 行内的 Command View（生产 `.tool-call-result-scroll`）；外层执行台
不随方向变化。inline code 在三案中固定为略偏灰的 Mist canvas，并移除描边，Night 也比当前
`#1d252b` 更轻。Shell 结果面的左边界与命令图标同轴，不再缩进到命令标题文本轨。

## 本地查看

直接打开 `index.html`，或在仓库根目录运行：

```bash
python3 -m http.server 4179 --bind 127.0.0.1 --directory docs/prototypes/command-view-steel-directions
```

然后访问 `http://127.0.0.1:4179/`。

这只是评审工件，不是 Renderer 实现或 UI 合同。确认方向后，生产改动仍应通过 Command View
专用语义 Token 完成，并覆盖底部 / Inspector placement、双主题、1040×700、200% zoom、键盘焦点与 reduced motion。
