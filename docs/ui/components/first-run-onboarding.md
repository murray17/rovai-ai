---
document_type: ui-component-spec
authority: first-run-onboarding-presentation
status: accepted
last_updated: 2026-09-08
---

# 首次训练与“初次集结”

## 结构

Full Core authority ready 后，前三页才作为全窗口 mandatory gate 挂载；Core 检查、迁移或阻断期间只显示
[Desktop Bootstrap Shell](bootstrap-shell.md)，不短暂显示训练页。训练页不显示普通侧栏、Camp、设置或可跳转步骤条：

1. 欢迎页只有品牌、“选一位队员，开始你的第一次协作。”和“选择队员”，不显示设置之后可修改的重复说明；
2. 队员页左侧只显示当前选择的一张大半身像，右侧用四条纯文字行选择内置队员；
3. “选择运行时”页显示紧凑队员摘要和真实扫描过程；有可直接继续的 Runtime 时显示正式 Runtime 状态和复用队员
   运行配置的模型字段，无可用 Runtime 或本轮没有可靠结果时显示统一空结果页；权限控件不得出现；
4. 第三页保存成功后进入普通 App Shell 中真实的 Active Quick Chat `初次集结`。

队员页标题为“选择第一位队员”，说明“之后可以继续邀请其他队员。”；完整职责通过“了解工作方式”展开。
队员与运行时采用中性选中底色、单选圆环与中心点，不用身份色竖线或黑色圆盘勾选。运行时状态在右侧以
纯文字表示，与左侧选择控件分开；可用状态仍保留语义色。两组单选支持方向键、Home / End 与可见焦点。

欢迎页和队员页没有 Skip。Runtime 正常配置分支仍必须完成配置，按钮为“开始对话”；只有统一空结果页提供“稍后配置”，其
语义是终止训练营并延后 Runtime 配置，不是跳过前置页或暂停。Back 只回到前一页，并且 provisioning 开始后
不再允许更换前置选择或延后配置。用户重新打开 App 时先经过 Bootstrap capability gate；authority ready 后
直接回到未完成页，不短暂展示普通业务工作区。

## Runtime 状态

扫描只表达“查找安装入口 / 执行无副作用的有界身份命令”，使用真实 discovery 与 managed Installation，且不
自动启动登录、ACP、Session 或模型目录深检。`light_ready` 显示“可用”，严格表示 executable 已成功轻度启动、
输出未超限且身份可识别，可以选择并尝试运行；支持文案说明登录、模型与能力将在显式检查或首次任务的统一
Dispatch Preflight 中确认。
只找到 executable 的 `found_uninspected` 不显示“正在检查”或“可用”。不可用、需要登录、版本不支持和
旧 `installed_unverified` 不能被改写成深检 Ready，也不能继续 onboarding；页面引导用户先执行“检查可用性”。
当前 TRAE light-ready、模型目录与 Dispatch Preflight 行为使用统一 Runtime 规则。

模型字段复用队员运行配置的 schema 驱动组件。Runtime Default 不依赖 catalog；显式模型需要 24 小时内可服务
且未失效的 catalog。打开 Picker 使用 Core-owned 60 秒 stale-while-revalidate，切换 Runtime 不触发 discovery。
页面只告诉用户选择 Runtime 与模型，权限取 Adapter 静态默认值且
不在 onboarding 展示。

扫描结束后，如果没有任何 Runtime 同时满足平台资格、产品可用状态、managed default、Adapter-owned
defaults 与可保存模型选择，或者扫描异常/超时没有形成可靠结果，右侧工作区替换为空结果页。完成扫描但无可用结果显示
“暂未找到可用的运行时”，扫描失败单独显示“这次扫描未完成”，不能以过期健康快照伪装本轮成功。
提供“查看安装引导 / 重新扫描”，安装链接复用运行时官方文档地址表；不执行安装命令。错误详情按需展开。
重新扫描回到真实扫描进度；“稍后配置”持久化 `runtime_deferred`，不创建队员配置、Camp 或 Run。
该页继续保留左侧已选队员摘要，但摘要只是未物化选择，终态不保存为产品成员身份。

## 第四页

无消息、无 AgentRun 的 `初次集结` 默认打开“会话”而不是“地图”，即使通用 Camp 偏好是地图。用户仍可
主动切到地图；发送首条消息后，后续重启恢复普通 Camp 视图偏好。

欢迎区使用真实所选队员头像、“你好，我是{name}。”与“从一件具体的事开始。”，不再重复成员／负责人或
对话保存状态。三张整卡按钮固定为“创建一位新队员”“创建一个定时任务”“做一个实用小工具”，不因角色改变，
不显示字母索引或“填入”标签。第一张保留原 member-studio 草稿；后两张引导用户先确定任务内容、时间或工具功能，
不讲解 Camp 等内部概念。

选择卡片只替换 Composer Draft、聚焦并把光标放在末尾。仅辅助技术可见的 live status 说明“草稿已准备好，可编辑后发送。”。
不得自动点击发送、创建消息/Run、创建定时任务或调用 Skill；输入框直接复用会话共享组件和既有保存／发送行为。

## 响应式与无障碍

- 最低验收尺寸为 `1040×700`；主操作、队员四行、Runtime footer、三条 starter 与 Composer 必须可见或
  在明确的局部纵向滚动区内到达，页面和会话时间线不得横向溢出。
- Porcelain Day 与 Steel Night 共享结构、Token 和状态；主题切换不能丢失进度。
- Radio 行使用真实 `role="radio"` / `aria-checked`；扫描和填草稿反馈使用 live region。
- 所有主操作、Back、主题、Runtime、安装说明和 starter 行支持键盘与 `:focus-visible`。
- `prefers-reduced-motion` 下停止扫描点和位移动画，但不隐藏状态。

## References

- [First-run Onboarding v3](../../contracts/first-run-onboarding-v3.md)
- [Desktop Bootstrap Shell](bootstrap-shell.md)
- [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)
- [Camp 会话工作区](conversation-workspace.md)
- [全局设计系统](../../../DESIGN.md)
