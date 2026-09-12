---
document_type: ui-interaction-draft
authority: desktop-web-interaction-parity-review
status: draft
target_version: v1.59
last_updated: 2026-09-12
---

# Desktop 对照的宽屏 Web 交互验收稿

审阅基线为 PR #345 的 `077bf78e64c76e934c45675ddb55e05165a2c49f`；实施前已核对本地 HEAD 与 PR head
一致、工作树干净。用户已确认本稿方向，当前进入 A–D 实际收敛；Mobile、扩平台、容器和发布优化暂停。
实际 `apps/web` 已挂载共享生产 BusinessApp/Camp 页面，下面按最新源码更新实现缺口。固定模拟稿保留为组件组合证据，
不再扩展，也不能代替真实 Host 与两端验收；实际结果见[实施计划](../versions/v1.59/implementation-plan.md)。
用户随后单独要求的[远程连接设置稿](host-remote-connection.md)只增加该设置菜单的评审材料，不重做本稿的 Camp 场景。

## 一张行为差异表

“Desktop 行为”取自该基线的生产组件与调用路径，不能代替本机全部流程实测。
G 表示应消除的实现缺口；P 是明确的平台差异；D 只用于用户确认暂停的范围。
G 不得改写为“Web 不支持”。下面列出的 Host 操作是需要逐项授权的服务入口，不是批量公开内部 RPC 的清单。

| 页面/动作与分类 | Desktop 生产行为 | 当前 Web 行为 | 应共用组件 | 缺失 Host/Remote 操作 | 允许的平台差异 | 验收方式 |
| --- | --- | --- | --- | --- | --- | --- |
| Camp 导航与工作区 · G | 项目/快速对话分组、分页、固定、改名；消息/执行/Composer/队员/任务在同一工作区 | 已复用生产导航、消息、执行、Composer 及其页面协调逻辑；改名/固定等尚待准入 | `CampNavigation`、`AppHeader`、`CampWorkspace`、`SafeMarkdown` | Camp 完整 open projection、按权限投影的动作；`camps.enter/open` 与已有分页服务适配 | P：浏览器无原生窗口拖拽/恢复；导航偏好按客户端保存 | 同 fixture、1440×920、日夜主题核对主要操作位置；再用真实 Camp 验证分页和刷新 |
| 新建 Camp · G/P | 选择工作区和已配置队员、Default Lead，再创建对话；Runtime 配置在队员页完成 | 已复用生产新建 Dialog 和授权工作区选择；真实浏览器完整配置链路待验收 | `NewConversationDialog`、`MemberRuntimePicker`、队员配置页 | 工作区授权清单/inspection、creation preflight、`camps.create` 及回执查询 | P：原生目录选择改为 Host 允许目录选择，不能任意提交 Host 路径 | 空目录 Host 的受信本机初始化后，浏览器完成选择/配置/创建；重试使用原 commandId |
| Composer 与引用/待发送 · G | 结构化 Mention、回复、引用、附件、revision 校验、待发送编辑与冲突反馈 | 独立草稿、revision、发送及原子移回普通输入框已接通；旧会话显式接管，附件在普通 Composer 中继续上传 | `StructuredMentionComposer`、`CampWorkspace`、`PendingCampInputs`、草稿协调器 | 草稿独立身份及后端归属；现有 draft/pending 服务绑定 client 与 Camp，发送原子消费 | P：缓存与输入焦点属客户端；不跨端同步草稿 | 两标签页不同内容/附件互不覆盖；伪造归属失败；陈旧 revision 不消费新内容；断网按原回执核对 |
| 私聊 · G | Camp 内独立 Conversation、私有终端与待发送队列 | 无 | `SingleChatPanel`、共享 Composer/附件/执行组件 | Conversation 范围的草稿/资源/事件鉴权，open/get/send/end、pending 与回执 | 无第二套私聊规则；客户端状态隔离 | 私聊与公共草稿不串；其他客户端不能读取不属于自己的编辑内容；结束与取消沿用 Core |
| 执行、停止与审批 · G | 执行台、工具详情、原生选项、提交中、恢复与停止反馈 | 已复用生产执行台和 Host 审批选项；实际浏览器发送、原生审批、产物阅读和停止通过；更广恢复与双入口执行矩阵待补 | `RunExecutionDisclosure`、`ExecutionToolGroup`、`ApprovalDock`、恢复提示 | 授权 run/evidence、`agentRuns.cancel`、`campTurns.cancel`、`action.approvals.resolve` 与 command result | P：Web 连接状态；不改写 Runtime 原生选项、不放宽权限 | 真 Runtime 请求审批；两客户端竞争只有一个有效决议；丢回执不重派发；停止和恢复有实际结果 |
| 附件、产物与文件预览 · G/P | source ref、拖放、文件 Tabs、Markdown/代码/图片阅读、系统打开/定位 | source 上传、授权文本/图片预览及下载已接通；分页、相对资源和文件监测仍有缺口 | `AttachmentCard`、`ImageGallery`、`FilePreviewProvider/Pane/Tabs`、`SafeMarkdown` | 临时上传→草稿绑定；未知绑定回执；按资源 locator 授权读取/下载/失效；复用 Core 引用交接 | P：浏览器上传/下载替代系统打开/定位；首版不执行用户 HTML | 未绑定清理、未知绑定不误删、失效提示、越权/路径穿越拒绝；源文件不因发送失败或移除引用误删 |
| 队员/Runtime · G/P | 完整名册、身份表单、原生 Runtime 模型/权限、保存冲突与检查反馈 | 已复用正式名册和 Runtime 表单，接通配置/检测；头像编辑等原生依赖待补 | `MembersView`、`MemberSidebar`、`MemberIdentityEditor`、`MemberRuntimeForm/Parameters` | 成员创建/更新/运行绑定/移除与版本；Runtime 发现/检测/模型目录的安全 DTO | P：在 Host 检测和认证 Runtime；浏览器不能选择自己机器的可执行文件冒充 Host 安装 | 配置后真实创建/发送；检查失败和版本冲突保留编辑；秘密配置不因表单复用而公开 |
| Task · G | 创建/编辑/指派/状态与验收标准、审计及关联执行 | 已复用正式 TaskPanel；动作授权尚待补齐 | `TaskPanel`、`TaskTimelineCard`、任务字段和审计组件 | `tasks.create/update/get/list` 与版本、指派准入、事件刷新 | 无业务差异 | 每项原动作、冲突/失败态、刷新与执行关联；不是“列表有数据”即完成 |
| Memory · G/P | Library、详情、版本、治理/删除、review 与导出 | 独立列表已移除；正式页面的客户端依赖和管理动作尚待接通 | `MemoryLibrary` 及内部表单/抽屉 | 原 Memory 查询、变更、review 和导出服务的授权适配 | P：导出下载替代本机保存/定位 | 按原动作逐项验收，含并发变更、scope、错误和刷新 |
| Automation · G | 工作区模板、定义编辑、执行记录；当前调度驱动在 Desktop Main | 独立列表已移除；正式页面适配与 Headless 后台时钟尚待完成 | `AutomationWorkspace` | automations 创建/更新/关闭/删除/运行；Host 时钟与原恢复合同衔接 | P：浏览器关闭不影响 Host 调度；按既有规则处理 missed/overlap | 关闭所有浏览器且不运行 Desktop Main 后仍按规则触发；重启恢复不额外重放 |
| Skills/MCP · G/P | 导入、详情/内容、分配、启停与编辑 | 独立列表已移除；正式设置页面尚待适配，MCP 秘密过滤保留 | 现有 Skills/MCP 设置工作区与成员分配组件 | 逐项开放 library/import/assignment/config 领域操作和脱敏 DTO | P：目录/文件选择改为受授权导入；Host 路径与秘密仍受限 | 完整原动作、冲突/失败/权限与刷新；不能简单取消 `availableActions` 或秘密过滤 |
| 必要设置 · G/P | 外观、个人资料、执行台偏好及桌面集成 | 生产通用页已显式注入偏好接口；外观与导航偏好按 origin/Owner 保存；其他管理页仍待适配 | 生产设置页内业务 sections，主题/profile/偏好适配 | Host 业务设置按需提供；本地偏好留客户端 | P：Web 使用浏览器自己的缩放菜单/快捷键；登录/撤销/连接属 Web；托盘、窗口、更新、Desktop Web 开关留 Desktop | 同一业务设置一致；不同客户端主题/导航偏好不互相覆盖；失效会话和迟到响应可恢复 |
| Mobile、额外平台、容器/发布优化 · D | 保留既有成果和回归 | 保留当前预览 | 本轮不新增页面或平台结构 | 本轮暂停 | 长期 Server 仍三平台同一实现 | 阶段 1–3 完成后再继续，不以暂停撤销原长期目标 |

## 可点击对照稿与范围

运行 `pnpm review:host-web-parity`，打开输出的 `out/review-delivery/host-web-parity/rovai-desktop-web-parity.html`。
它是可离线打开的构建产物：在固定 1440×920 iframe 中运行生产 React 组件，外部工具栏负责切换
Desktop/Web、路径、主题和模拟离线，不属于产品导航。没有建立另一套业务页面或组件样式。
构建源在 [`scripts/fixtures/host-web-parity`](../../scripts/fixtures/host-web-parity/renderer.tsx)，沿用既有 UI fixture/test 体系。

- 已有 Camp：相同固定消息、Composer、执行台、任务/队员入口，可编辑本页草稿、模拟发送。
- 新建 Camp：生产 Dialog；选择固定授权目录、队员和负责人后模拟创建。Runtime 沿用 Desktop 的队员页配置入口，
  可先关闭新建 Dialog，进入「队员」完成模拟配置，再返回新建；没有另造一套嵌套 Runtime 表单。
- 运行中/审批：真实生产详情结构与固定 Runtime 原生选项；提交期间禁用重复操作，随后呈现已处理状态。
- 附件/文件：固定 Markdown 的生产预览；Web 通过资源适配下载固定示例，Desktop 系统动作明确标为模拟。
- 队员/Runtime：生产名册与运行配置表单，模拟保存；不会探测、更改或认证本机 Runtime。

所有 mutation 仅作用于当前 iframe 的内存，重置即清空。未覆盖的操作抛出明确错误或在稿外提示，不返回空值
冒充成功。`window.rovai` 没有被伪造。文件 API 只接受固定示例，不读取真实工作区；原生审批 fixture 不等于
Host 发出的真实审批。两 iframe 编辑独立不能证明后端草稿归属已完成。

Desktop 基准也是生产组件的受控组合夹具，排除了原生启动、窗口外框和日常数据；不是维护者日常 App 截图。
旧 Desktop 的运行/退出、真实数据库与 Runtime 验收仍需另行保留。组件/API 迁移说明见
[复用与调用](../versions/v1.59/frontend-reuse.md)。

## 对照注意与验收记录

源码存在一个现状差异：`DESIGN.md` 与 App Shell 文档描述通用 50px 顶行，但当前生产 CSS
`.app-shell-camp` 明确使用 38px。首轮 Electron 夹具也测得 38px。本稿复用该生产样式并要求 Web 与 Desktop
相等，没有为了匹配文档数字修改生产布局；这项文档—实现差异单独记录，不影响“共用同一页面”的目标。

`pnpm test:host-web-parity` 在独立 Chrome/Electron profile 中检查相同 fixture 的视口、页面、主题、
无原生全局桥接依赖、交互与截图。它不启动 Core/Runtime。测试缺少浏览器时明确跳过，不能计为通过。
自动点击覆盖本页模拟发送、授权目录/队员选择与新建、工具组/完整结果展开、原生选项提交/处理、
固定示例下载和 Runtime 配置保存；同时检查独立 HTML 的入口切换、主题、场景和模拟连接状态。
本轮实际执行结果由版本实施计划记录；此文档本身不构成通过证据。

确认一次上述交互基准后，按 A 共享 Camp → B 真实写入闭环 → C 双 Host 入口一致 → D 逐页业务能力推进。
安全发布决策等待期间继续受控本机共享 UI 和非发布测试；不能以隔离问题为理由把共同业务功能永久降为只读。
