# Renderer P2 · Conversation / Settings / Members / Memory study

这是一次性的、独立自包含 HTML 视觉原型。它沿用[Porcelain Gray 来源研究](../porcelain-gray-study/rovai-porcelain-gray-study.html)的 P2 Neutral Porcelain 视觉语言，页面结构与交互语义来自当前 Rovai-ai Renderer；不会修改生产 Renderer，也不会连接或写入 Core。

本轮在既有设置、队员、记忆及覆盖层基础上，把 Camp 会话区同步到生产提交 `95e4aa2`、ADR-0154 与 Run Process Detail Surface v2 的定稿合同；`agent-execution-process-b` 只作为交互参照，不复制它的 App Shell、Composer 或 Approval 示例。

## 预览

直接打开 [`rovai-p2-empty-camp.html`](./rovai-p2-empty-camp.html) 即可。HTML 不加载外部字体、脚本、图片或网络资源；四组生产内置角色图片已压缩并以内嵌 data URI 保存。

也可以在项目根目录运行：

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/prototypes/renderer-p2-empty-camp
```

然后访问 `http://127.0.0.1:4173/rovai-p2-empty-camp.html`。

侧栏可直接进入“队员”“记忆”和“设置”。设置模式会完整替换普通导航；返回 App 后保留本地 Camp 草稿、Lead、Inspector 页签、Execution Drawer 状态与全部历史证据。

## 原型范围

- 完整设置导航与七个页面：通用、外观、通知、Skill、MCP、Agent 运行时、诊断与修复。
- Active Camp 会话：你与队员统一左对齐；消息复制只在 hover / focus 时显示 icon-only 按钮；会话 Task 使用 status / title / assignee 紧凑卡。
- 项目侧栏：directory Project 与快速对话均使用文件夹主行，不显示独立折叠图标；项目三点菜单与新增按钮独立于主行，支持整项目置顶。此探索按本轮确认，用稳定浅灰底表达当前 Project，不显示“当前”文字。
- 新对话 Dialog：保留快速对话、已知 Project、选择工作目录、非阻塞 Git 观察、至少一位队员、Lead 联动与 80 字可选名称；不显示重复的“创建摘要”或静态黄色说明。
- 会话视觉：所有 Agent 消息使用同一中性表面，身份色只留在头像与作者名；日期使用生产 `M月D日 周X · DAY N` 格式。A2A footer 显示 `发送给@队员`，`@队员` 使用可交互的飞书式蓝色 Mention。
- 底部执行台：每位队员只有一个长期入口，同一队员的多次 AgentRun 在同一个 Execution Drawer 内连续呈现。Drawer 初始关闭且只由用户点击 Agent 打开；最新 running Run 会被聚焦并默认展开，终态 Run 可被聚焦但历史证据保持折叠、仍可手动展开和反复重开。
- Inspector 仅保留任务、上下文投递、审批三个页签；删除的是界面上的审计页签，不改变底层 AgentRun、Evidence、取消或审计边界。
- 队员名册与详情：身份 / 运行配置两个页签、在队 / 暂离状态、同源圆形 icon 和 4:5 半身照，以及包含四个生产预设的头像选择、身份、离队、移除等本地交互示例。
- 成员 Header 中 Presence 是静态状态；Runtime 是带状态点、状态文字与右箭头的可点击入口，进入运行配置后聚焦 Runtime 选择器。
- 记忆目录与详情：共同记忆、队员记忆、队员间记忆，治理筛选、修订 / 停止沿用 / 永久遗忘，以及共同记忆提案 Drawer。
- 队员与记忆工作区从右侧窗口顶边直接开始，3px Steel 顶边之后进入各自页面 Header；右侧不保留独立 50px 空白拖拽区。两页 Header 自身承担拖拽，真实按钮和菜单保持可点击。
- 新建 Camp、队员、Skill、MCP、Runtime、诊断、记忆等共用 Dialog，以及通知中心和记忆提案 Drawer；浮层支持 Esc、焦点约束和关闭后焦点返回。
- P2 冷瓷灰与 Steel 只建立壳层和选择层级；身份、成功、警告、危险、证据继续使用独立语义色。
- 队员身份色按生产相同的 FNV-1a 规则将稳定 `AgentProfile.id` 映射到 `--identity-1..8`，不随显示名或团队角色变化。
- `>=1800px` 时 Composer 扩展到 1040px；1440 和最小 1040 仍受会话列可用宽度约束。

所有“保存”“导入”“修复”“删除”“发送”都只提供本地视觉反馈，不访问文件系统、不发起网络请求、不修改 Core、Main 或 Desktop Shell。Runtime、MCP 和诊断内容均标记为示例快照，不代表本机真实状态。
