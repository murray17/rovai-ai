---
document_type: protocol-contract
contract: first-run-onboarding-v3
authority: desktop-first-run-state-authority-origin-provisioning-deferral-and-draft-entry
status: accepted
version: 3
last_updated: 2026-08-30
---

# First-run Onboarding v3 Contract

本合同替代 [v2](first-run-onboarding-v2.md) 作为当前入口。v2 的 schema 2、三页 mandatory flow、幂等
provisioning、`runtime_deferred` 与 Draft-only 第四页保持不变；v3 只替换首次安装 admission 与偏好故障边界。

## 1. Authority-origin admission

Electron Main 不再通过启动前 `exists(rovai.sqlite) || exists(lumen.sqlite)` 猜测首次安装。它先显示 Desktop 壳层，
加载 `onboarding.json` 到内存，再由 Full Core 的已准入 ready 快照初始化 onboarding：

- `authorityState = current(origin = initialized)`：没有已持久 onboarding 状态时进入 `in_progress(welcome)`；
- `origin = existing | migrated`：没有已持久状态时进入 `completed(existing_installation)`；
- Core 尚未 ready、authority 被阻断或迁移失败：保持当前内存状态，不初始化、不覆盖文件、不显示普通权威工作区。

已持久的 `in_progress` 或 `completed` 仍优先，初始化保持幂等。Core 只有在票据确认 absence 并成功发布全新 authority 后
才能报告 `initialized`；文件名存在、sidecar 孤儿或探测失败都不能成为“新安装”证据。

## 2. Preference degradation

`onboarding.json` missing 使用内存 `uninitialized`，ready 后按 authority origin 正常持久初始化。文件损坏或不可读时，
Main 使用内存 `uninitialized`、向 Supervisor 发布本机降级，但保留原文件；ready 后可在内存初始化，不能自动覆盖损坏
文件。后续用户明确执行 onboarding transition 时，才通过正常原子写入提交新 snapshot。

偏好故障不能阻止 Full Core ready；Full Core 阻断也不能把 onboarding 默认态挂载成普通产品工作区。

## 3. Unchanged schema and flow

当前 snapshot 仍是 v2 定义的 exact-key `schemaVersion: 2` 联合，页面仍为
`welcome -> member -> runtime`。正常 provisioning 仍先冻结 command IDs 与 Adapter-owned permissions，再依次
保留/创建成员、配置 Runtime、创建 `初次集结`、提交 restorable location、完成 onboarding。无直接可用 Runtime
且 provisioning 尚未开始时，仍可完成为 `runtime_deferred`，且不创建产品对象。

## 4. Renderer gate

Bootstrap Shell 与 First-run Onboarding 是两个串行 gate：

1. `authoritativeWorkspace = false` 时只挂载 Bootstrap Shell；
2. Full Core ready 后，正常 App tree 才读取 onboarding snapshot；
3. 未完成 onboarding 替换正常工作区；完成后进入普通 App Shell。

因此迁移中、租约占用或 authority 阻断不会短暂显示 onboarding，也不会把空数据渲染成新安装。

## References

- [First-run Onboarding v2（历史）](first-run-onboarding-v2.md)
- [First-run Onboarding Architecture](../architecture/first-run-onboarding.md)
- [Desktop Runtime Availability v1](desktop-runtime-availability-v1.md)
- [首次训练 UI](../ui/components/first-run-onboarding.md)
