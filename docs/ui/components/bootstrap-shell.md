---
document_type: ui-component-spec
authority: desktop-bootstrap-shell-presentation
status: accepted
last_updated: 2026-08-30
---

# Desktop Bootstrap Shell

Bootstrap Shell 是 Supervisor 明确进入 `blocked` / `crashed` 后可见的非权威恢复面。它沿用 Porcelain Day / Steel Night
与既有品牌，不是每次启动的默认页面，也不是空工作区。

BrowserWindow 创建后先显示普通 App rail/顶行；本机 Main Window Session 给出恢复目标后显示对应页面框架。Core 的正常
检查、迁移和自动重启都不接管全屏；前 400ms 没有加载提示，超时仅在目标内容区 loading。框架只含非权威 chrome，
未取得能力前不挂载查询 hooks、显示业务空态或启用业务操作。ready 后仍未完成的 Onboarding admission 与目标投影读取
沿用同一计时，不能重置 400ms 或闪现另一张全屏启动页。

## Structure

主卡片只表达明确的 authority/Supervisor 阻断：另一个 Core 占用、迁移失败、Core 意外停止或其他
准入阻断。文案必须明确原数据被保留；不能显示 Camp、队员、Memory、最近项目或这些对象的空态。

Windows `preparing_windows_data_root` 失败明确表示“本机数据目录尚未准备好，Core 未启动”，不能称作数据库损坏。
重试按钮为“重启并重新检查”，说明将重启桌面壳层；独立壳层偏好不会覆盖正式工作区偏好。

可用动作只有 Supervisor 声明的本机能力：

- `fullCoreRetry` 时重新检查；
- 导出 bootstrap diagnostics；
- 切换 `system/day/night` 本机主题；
- 阅读本机偏好降级提示。

正常迁移在目标页的局部 loading 中说明“正在升级本地数据”，不承诺百分比；完成只能由更高 revision 的 ready snapshot
与真实目标数据确认。诊断导出在 Core
不可用时包含 Desktop/App/platform 与完整 Supervisor snapshot，不尝试调用 Core diagnostics。

## Interaction and accessibility

- Renderer 先注册 `onChanged` 再调用 `getSnapshot`，只接受更高 revision，避免 first-read race；
- authority capability ready 前，权威 hooks 不得挂载；正常页面的非权威框架不受此限制；
- 状态卡使用 polite live region，动作失败使用 alert；按钮 busy 时不可重复触发；
- 主题按钮使用 `aria-pressed`，全部动作支持键盘与 `:focus-visible`；
- `prefers-reduced-motion` 下停止迁移动画但保留进度轨与文字状态；
- 窄窗口改为单列，动作保持可达，不出现横向滚动。

## Full Core feature degradation

authority ready 后的 `coreSubsystems` 降级显示为正常工作区底部的紧凑状态区，不替换整个 App、Camp 或任务页面。
它明确记录仍可使用，按功能给出真实原因、可展开详情和“重试受影响功能”；busy 时禁用重复提交，错误以 alert 展示。
恢复在同一 Core generation 完成，状态区撤出但权威树不重挂载；失败不能伪装成空 Skill/MCP 列表。使用既有 day/night
tokens、自然换行和有界滚动，在最小窗口与放大视口下保留键盘恢复入口。

## References

- [Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)
- [Availability-first Runtime](../../architecture/availability-first-runtime.md)
- [全局设计系统](../../../DESIGN.md)
