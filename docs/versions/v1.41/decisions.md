---
document_type: version-decisions
version: v1.41
lifecycle: current
last_updated: 2026-09-04
---

# v1.41 决定

<a id="v1-41-d01"></a>
## V1.41-D01：Sidecar Project 顺序首次冻结并由 Main 本机偏好拥有

### 背景

Core Navigation Read Model 需要按最近活动组织 Camp，并长期把每个 Project 的代表 Camp 活动时间用于
Project 数组排序。这个数组直接进入 Sidecar 时，一条新消息会让整个 Project 跳到前面；用户已经形成的
空间记忆因此持续变化。另一方面，升级时不能突然改为路径或名称排序，否则会立即打乱用户当前看到的顺序。

Project 仍是由 directory-backed Camp 动态聚合的读模型，不值得仅为侧栏位置建立 SQLite Project 实体、
领域事件或跨设备同步。现有 `navigation.json` 已经拥有本机 pin 与 Project 移除偏好，并具备私有原子写入和
恢复边界。

### 决定

Main-owned Navigation Preferences schema 3 增加 nullable `projectOrder`。`null` 只表示尚未完成首次冻结：
Sidecar 第一次取得当前可见 Project 列表后，按 Core 仍提供的旧版活动顺序写入 canonical Project key。
此后同步只保留仍存在 key 的原相对顺序、按发现顺序追加新 key，并清理消失或本机移除的 key；活动变化
不能重写既有顺序。

Core 继续拥有 Camp 活动顺序、时间、marker、Project 聚合及首次/新项的发现顺序。Renderer 在每次完整
Snapshot 后读取 Main 偏好并投影最终 Sidecar Project 顺序，不从增量事件猜位置，也不修改 Core Snapshot。
当前规范由 [Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md)、
[产品与导航不变量](../../architecture/foundational-invariants.md#product-navigation)和
[App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)拥有。

### 后果与被拒绝方案

- 用户升级瞬间不会看到主动重排；之后消息活动只改变 Project 内 Camp、时间和未读反馈。
- `navigation.json` 的顺序是设备本地偏好；目录在移除后再恢复会作为新发现项追加，而不是恢复旧位置。
- 拒绝继续直接使用 Core 活动排序：它无法提供稳定空间记忆。拒绝升级时改为字母、路径或创建时间排序：
  它会破坏“冻结当前所见”的迁移语义。
- 拒绝把顺序写入 SQLite/Core Project 表：Project 没有独立领域生命周期，且本机侧栏偏好不应扩大为领域或
  跨设备同步模型。拒绝只保存在 Renderer 内存或 Local Storage：它不能复用 Main 的原子私有偏好、并发串行和
  恢复证据边界。
