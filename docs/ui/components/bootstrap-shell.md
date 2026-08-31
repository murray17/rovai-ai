---
document_type: ui-component-spec
authority: desktop-bootstrap-shell-presentation
status: accepted
last_updated: 2026-08-31
---

# Desktop Bootstrap Shell

Bootstrap Shell 是 Supervisor 明确进入 `blocked` / `crashed` 后可见的非权威恢复面。它沿用 Porcelain Day / Steel Night
与既有品牌，不是每次启动的默认页面，也不是空工作区。

BrowserWindow 创建后先显示普通 App rail/顶行；本机 Main Window Session 给出恢复目标后显示对应页面框架。Core 的正常
检查、迁移和自动重启都不接管全屏；前 400ms 没有加载提示，超时仅在目标内容区显示“正在打开会话”。框架只含非权威 chrome，
未取得能力前不挂载查询 hooks、显示业务空态或启用业务操作。ready 后仍未完成的 Onboarding admission 与目标投影读取
沿用同一计时，不能重置 400ms 或闪现另一张全屏启动页。

## Structure

主卡片统一显示“暂时无法打开会话”，提供“重新打开”与“导出诊断”。不按 Core、SQLite、migration 或内部错误类型
切换标题，不显示原始 message/code、路径、备份、合同版本或复制页数。技术原因留在 Supervisor 与诊断中；不能显示
Camp、队员、Memory、最近项目或这些对象的空态，也不承诺部分事务已提交后整个文件仍与升级前字节相同。

Windows `preparing_windows_data_root` 的“重新打开”仍由 Main 使用原参数 relaunch Desktop，不在 ready 后重新绑定
sessionData；独立壳层偏好不会覆盖正式工作区偏好。产品恢复面与其他启动失败使用同一文案。

可用动作只有 Supervisor 声明的本机能力：

- `fullCoreRetry` 时“重新打开”；
- 导出 bootstrap diagnostics；
- 切换 `system/day/night` 本机主题；
- 阅读本机偏好降级提示。

正常迁移与其他内部启动步骤始终使用“正在打开会话”，不显示百分比或单独的迁移完成状态；只由更高 revision 的 ready
snapshot 与真实目标数据结束等待。有限瞬时重试期间继续原页面框架和原 400ms 计时。诊断导出在 Core 不可用时包含
Desktop/App/platform 与完整 Supervisor snapshot，不尝试调用 Core diagnostics。局部偏好与动作失败同样使用安全产品
提示，不把底层异常直接展示出来。

## Interaction and accessibility

- Renderer 先注册 `onChanged` 再调用 `getSnapshot`，只接受更高 revision，避免 first-read race；
- authority capability ready 前，权威 hooks 不得挂载；正常页面的非权威框架不受此限制；
- 状态卡使用 polite live region，动作失败使用 alert；按钮 busy 时不可重复触发；
- 主题按钮使用 `aria-pressed`，全部动作支持键盘与 `:focus-visible`；
- `prefers-reduced-motion` 下停止普通 loading 动画，保留文字反馈；
- 窄窗口改为单列，动作保持可达，不出现横向滚动。

## Full Core feature degradation

authority ready 后的 `coreSubsystems` 降级显示为正常工作区底部的紧凑状态区，不替换整个 App、Camp 或任务页面。
它明确记录仍可使用，按功能给出真实原因、可展开详情和“重试受影响功能”；busy 时禁用重复提交，错误以 alert 展示。
恢复在同一 Core generation 完成，状态区撤出但权威树不重挂载；失败不能伪装成空 Skill/MCP 列表。使用既有 day/night
tokens、自然换行和有界滚动，在最小窗口与放大视口下保留键盘恢复入口。

## References

- [Desktop Runtime Availability v2](../../contracts/desktop-runtime-availability-v2.md)
- [Availability-first Runtime](../../architecture/availability-first-runtime.md)
- [全局设计系统](../../../DESIGN.md)
