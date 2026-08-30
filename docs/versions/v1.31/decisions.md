---
document_type: version-decisions
version: v1.31
lifecycle: current
last_updated: 2026-08-30
---

# v1.31 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-31-d01"></a>
## V1.31-D01：Desktop 壳层 fail open，SQLite authority fail closed

### 背景

把窗口生命周期与 Core/SQLite 成功启动绑定，会让迁移、占用或偏好错误表现为整款应用退出；但用临时空库继续又会
制造第二个权威世界。

### 决定

Desktop 先提供主题、Supervisor、重试和诊断；Full Core 通过 capability 独立晋升。业务树只在 authority ready 后
挂载，阻断期间没有假空态或 fallback database。

当前规范见 [Availability-first Runtime](../../architecture/availability-first-runtime.md)与
[Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)。

### 后果

- 用户能看见并处理启动阻断，原数据不被空工作区掩盖；
- Renderer 必须把 capability gate 放在所有权威 hooks 外层。

### 被拒绝方案

- **Core 失败即退出 Electron：** 把局部权威故障扩大为全产品不可用；
- **自动打开临时/空 SQLite：** 形成第二权威并掩盖恢复问题。

<a id="v1-31-d02"></a>
## V1.31-D02：lease 先于观察，DatabaseAdmission 用一次性票据授权下一步

### 背景

“先检查文件，再让任意 open(create)”存在 TOCTOU、双实例和错误文件名创建风险；SHM 又不能与 main/WAL 使用同一
绝对稳定规则。

### 决定

Core 先持有 data-dir OS lease。Admission 精确观察 Rovai/Lumen artifacts 并只读优先探测合同；若 SQLite 明确报告正常
journal recovery 需求，在同一 lease 的原 target 上让引擎恢复，再完整重新评估。返回绑定 lease、不可复制、一次消费的
existing/new/migration ticket。票据保存探测后的 main/WAL/journal 并严格复核；正常探测新建的空 WAL 与可重建 SHM
不视为 authority 替换。孤立 SHM 只在 exact identity 未变时清理。初始化使用 absence revalidation 与 no-replace commit。

当前规范见 [Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)。

### 后果

- `lumen.sqlite` 不再触发隐式 `rovai.sqlite` 创建；
- 检查、清理、打开和初始化共享同一 lease/identity 证明链。

### 被拒绝方案

- **文件存在性 boolean：** 丢失 sidecar、合同、identity 与 busy 语义；
- **所有 SHM 都要求字节不变：** 会把可变协调缓存误判为永久 authority blocker。
- **只读 probe 失败一律权限拒绝：** 会阻断正常 hot journal 回滚，用户反复重试也无法恢复工作区。

<a id="v1-31-d03"></a>
## V1.31-D03：历史合同只在一致副本上迁移，并用 identity manifest 恢复切换

### 背景

原库原地 migration 失败时难以区分旧、半迁移与新状态；只保存 stage 字符串也不足以在进程中断后证明 main 已切换。

### 决定

使用 SQLite Backup API 创建一致副本，在副本上迁移和完整校验；保存原 artifacts 与 original/migrated identity，原子
替换 exact source。恢复按当前 main identity 决定恢复旧 sidecar或保留新 main，未知 identity 阻断。

### 后果

- 迁移失败不修改原 authority；
- 切换窗口可以通过持久 manifest 在下一进程恢复；
- 需要长期保留操作级原件备份供人工诊断。

### 被拒绝方案

- **原地 migration：** 失败隔离与回退证据不足；
- **只看 manifest stage：** crash 可能发生在文件系统提交与 stage 更新之间。

<a id="v1-31-d04"></a>
## V1.31-D04：Supervisor 完整快照负责 generation fencing，偏好与 Onboarding 使用独立 fail-open 边界

### 背景

child 的迟到 exit/response 可能毒化新进程；Electron remote Error 会压平类别；Desktop 偏好损坏又不应阻止完整 Core。
旧 Onboarding 通过 SQLite 文件名存在性推断 fresh/existing，与新的准入状态机冲突。

### 决定

Supervisor 使用单调 generation、child token 与 revision 完整快照；pending request 按 generation 失败，确定性阻断不计
crash。Main/Preload 使用结构化 request transport，failure 以普通对象穿过 contextBridge；Error 只能在 Renderer 接收后
构造，避免 Electron 丢失自定义字段。本机偏好损坏使用内存默认、告警并保留原文件；Onboarding 从 ready authority
origin 初始化，而不是读取文件存在性。

当前规范见 [Desktop Runtime Availability v1](../../contracts/desktop-runtime-availability-v1.md)与
[First-run Onboarding v3](../../contracts/first-run-onboarding-v3.md)。

### 后果

- 旧 child 不能关闭或失败当前 generation；
- 领域拒绝与基础设施失败在 Renderer 仍可区分；
- 偏好故障与 authority 故障互不扩大，首次安装不再由路径启发式决定。

### 被拒绝方案

- **全局 failAll on child exit：** 会错误失败新 generation 请求；
- **Preload 在 Error 上挂结构化字段：** 字段在 contextBridge 复制 Error 时丢失，只有错误文字无法支撑状态判断；
- **损坏偏好即禁止 Core：** 把非权威文件升级成产品 authority；
- **启动前 exists 检查：** 无法区分旧库、孤儿 sidecar、迁移与真正 absence。
