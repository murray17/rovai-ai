---
document_type: ui-component-spec
authority: desktop-bootstrap-shell-presentation
status: accepted
last_updated: 2026-08-30
---

# Desktop Bootstrap Shell

Bootstrap Shell 是 BrowserWindow 创建后立即可见的非权威工作面。它沿用 Porcelain Day / Steel Night 与既有品牌，
不是新的产品主页，也不是空工作区。

## Structure

主卡片只表达当前 authority/Supervisor 状态：检查中、迁移中、另一个 Core 占用、迁移失败、Core 意外停止或其他
准入阻断。文案必须明确原数据被保留；不能显示 Camp、队员、Memory、最近项目或这些对象的空态。

可用动作只有 Supervisor 声明的本机能力：

- `fullCoreRetry` 时重新检查；
- 导出 bootstrap diagnostics；
- 切换 `system/day/night` 本机主题；
- 阅读本机偏好降级提示。

迁移中显示不承诺百分比的 progress indicator；完成只能由更高 revision 的 ready snapshot 结束。诊断导出在 Core
不可用时包含 Desktop/App/platform 与完整 Supervisor snapshot，不尝试调用 Core diagnostics。

## Interaction and accessibility

- Renderer 先注册 `onChanged` 再调用 `getSnapshot`，只接受更高 revision，避免 first-read race；
- authority capability ready 前，正常 App 与其 hooks 不得挂载；
- 状态卡使用 polite live region，动作失败使用 alert；按钮 busy 时不可重复触发；
- 主题按钮使用 `aria-pressed`，全部动作支持键盘与 `:focus-visible`；
- `prefers-reduced-motion` 下停止迁移动画但保留进度轨与文字状态；
- 窄窗口改为单列，动作保持可达，不出现横向滚动。

## References

- [Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)
- [Availability-first Runtime](../../architecture/availability-first-runtime.md)
- [全局设计系统](../../../DESIGN.md)
