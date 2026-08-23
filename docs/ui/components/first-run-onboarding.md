---
document_type: ui-component-spec
authority: first-run-onboarding-presentation
status: accepted
last_updated: 2026-08-23
---

# 首次训练与“初次集结”

## 结构

前三页是全窗口 mandatory gate，不显示普通侧栏、Camp、设置或可跳转步骤条：

1. 欢迎页只有品牌、简短说明和“开始旅程”；
2. 队员页左侧只显示当前选择的一张大半身像，右侧用四条纯文字行选择内置队员；
3. Runtime 页显示队员摘要和真实扫描过程；有可直接继续的 Runtime 时显示正式 Runtime 状态和复用队员
   运行配置的模型字段，无可用 Runtime 或本轮没有可靠结果时显示统一空结果页；权限控件不得出现；
4. 第三页保存成功后进入普通 App Shell 中真实的 Active Quick Chat `初次集结`。

欢迎页和队员页没有 Skip。Runtime 正常配置分支仍必须完成配置；只有统一空结果页提供“进入 Rovai”，其
语义是终止训练营并延后 Runtime 配置，不是跳过前置页或暂停。Back 只回到前一页，并且 provisioning 开始后
不再允许更换前置选择或延后配置。用户重新打开 App 时直接回到未完成页，不短暂展示普通 Shell。

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
defaults 与可保存模型选择，或者扫描异常/超时没有形成可靠结果，右侧工作区替换为“当前没有可用的 Agent
运行时”：显示安装入口、登录/版本、模型目录三项结果边界，可展开三个安装入口示例，并提供“重新扫描 / 进入
Rovai”。重新扫描回到真实扫描进度；“进入 Rovai”持久化 `runtime_deferred`，不创建队员配置、Camp 或 Run。
该页继续保留左侧已选队员摘要，但摘要只是未物化选择，终态不保存为产品成员身份。

## 第四页

无消息、无 AgentRun 的 `初次集结` 默认打开“会话”而不是“地图”，即使通用 Camp 偏好是地图。用户仍可
主动切到地图；发送首条消息后，后续重启恢复普通 Camp 视图偏好。

欢迎区使用真实所选队员头像和名称，下面只有三条轻量提示行：

- `A / B / C` 字母索引；
- 标题与一行说明；
- 明确的“填入输入框”动作。

选择提示行只替换 Composer Draft、聚焦并把光标放在末尾。绿色 live status 说明“已填入输入框，可修改后
发送”。不得自动点击发送、创建消息/Run 或调用 Skill。

## 响应式与无障碍

- 最低验收尺寸为 `1040×700`；主操作、队员四行、Runtime footer、三条 starter 与 Composer 必须可见或
  在明确的局部纵向滚动区内到达，页面和会话时间线不得横向溢出。
- Porcelain Day 与 Steel Night 共享结构、Token 和状态；主题切换不能丢失进度。
- Radio 行使用真实 `role="radio"` / `aria-checked`；扫描和填草稿反馈使用 live region。
- 所有主操作、Back、主题、Runtime、安装说明和 starter 行支持键盘与 `:focus-visible`。
- `prefers-reduced-motion` 下停止扫描点和位移动画，但不隐藏状态。

## References

- [First-run Onboarding v2](../../contracts/first-run-onboarding-v2.md)
- [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)
- [Camp 会话工作区](conversation-workspace.md)
- [全局设计系统](../../../DESIGN.md)
