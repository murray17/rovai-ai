---
document_type: ui-component-contract
authority: renderer-member-identity
status: accepted
last_updated: 2026-09-07
---

# 队员身份与图像

## 队员身份与图像

`AgentProfile.id`、`Skill.id` 与 MCP `serverId` 各自在现有组件中稳定映射
`--identity-1..8`。稳定 ID 决定序号，主题只提供对应可读色值。身份色只进入头像环、名称或小型
身份点，不表示运行、权限、审批、Presence、Lead、Capability 或选中状态。

一个受控 `avatarRef` 同时解析完整 portrait 与紧凑 icon，不增加第二个 Profile 字段。portrait
只用于队员详情、身份编辑和外观预设；圆形 icon 用于名册、详情标题、队员选择、Mention 候选和
消息身份位。两种 rendition 必须来自同一内置或受管复合资产。

未知引用、缺文件、完整性失败或图片加载失败统一回退到由队员名称派生的可读首字母；不能显示
破图、绝对路径或远程 URL。身份资产不得进入命令、Diff、审批、审计、错误、恢复或页面背景。

身份编辑支持圆形取景拖拽、缩放、键盘微调与实际尺寸预览。大图不能成为运行状态或权限判断的
来源。精确资产控制与持久化边界见
[成员投影不变量](../../architecture/foundational-invariants.md#member-projection)。

队员页的当前局部结构见
[`member-workspace` surface brief](../../../apps/desktop/.impeccable/surfaces/member-workspace.md)；
会话内锚定身份卡见[结构化 Mention](structured-mentions.md#锚定人物信息卡)。

## 队员配置页

右侧以同一滚动页面连续呈现“队员信息”和“运行配置”，不使用身份/运行配置 Tab，也不打开新增或
编辑弹窗。名称、团队角色、专业职责、性格底色与半身照直接编辑；工作准则和成长课题默认折叠，
折叠与切换队员均保留草稿。列表的运行时图标入口滚动并聚焦对应配置。

两部分分别通过页面中的“保存队员信息”和“保存运行配置”提交；保存一部分不清空另一部分的草稿。
外部变更冲突保留用户输入并阻止对应部分覆盖保存，显式重新读取只放弃该部分的修改。离开队员工作区
时保护所有队员的未保存修改。新增使用同一表单，只填写名称即可创建；底部的新队员草稿不计入名册。

角色图片的预设、上传和原有取景器在信息区内展开。图片跟随“保存队员信息”提交：创建命令可同时携带
图片；已有队员的文字和图片继续使用现有独立命令，后一步使用前一步回执中的版本。文字已提交而图片
失败时明确显示部分结果，保留图片草稿并仅重试尚未提交的内容；不声称跨命令原子性。

运行时菜单展示现有产品图标，模型策略默认项简称“默认”。文件系统访问、审批、权限模式等字段继续
服从原 Runtime schema、原始选项和默认值；可用性、模型缓存和平台冻结状态仍来自 Core。

## 验证

`node --test scripts/lib/member-editor.test.mjs` 使用生产组件与显式测试数据，在隔离 Electron 中验证
分区保存、草稿保留、失败重试、冲突、新建、菜单键盘焦点、双主题与桌面尺寸。设置
`ROVAI_KEEP_MEMBER_EDITOR_FIXTURE=1` 可保留截图。图像处理和命令提交分别由现有头像测试与
`member-identity-save.test.ts` 覆盖；真实 App 验收仍遵循[开发隔离规则](../../development/local-workflow.md)。
