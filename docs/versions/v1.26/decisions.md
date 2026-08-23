---
document_type: version-decisions
version: v1.26
lifecycle: historical
last_updated: 2026-08-22
---

# v1.26 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-26-d01"></a>
## V1.26-D01：Cursor identity 使用专名，并把 Catalog admission 与平台 qualification 分离

### 背景

Cursor 官方当前入口使用通用命令名 `agent`，但本机该名字已由 Grok Build `0.2.118` 占用。只按 basename
或命令成功发现会把另一个 Runtime 绑定成 Cursor。另一方面，Cursor Adapter、Migration 和 UI 可以在没有
登录的情况下确定性实现，而本机隔离候选只通过 initialize，authenticate 超时，没有资格证明完整 AgentRun。

### 决定

1. 稳定产品和 wire identity 为 `cursor-agent`，canonical command 同样为 `cursor-agent`；
2. `agent` 只作为兼容发现候选，并必须在写入 light evidence 前严格匹配 Cursor
   `YYYY.MM.DD-<build>` version identity；不匹配返回 `runtime_identity_mismatch`；
3. Cursor 进入 closed Product Runtime Catalog，使 Contracts、Migration、Adapter 与 Renderer 拥有唯一完整
   identity；
4. 每个平台仍独立通过 Runtime Platform Admission。没有完整行为 Smoke 的 macOS arm64、macOS x64 与
   Windows x64 都保持 `not_qualified`，不进行 discovery、配置、Probe 或执行；
5. 后续 qualification 必须新增 digest-bound evidence revision，不能把 initialize 或文档能力回填为通过。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v19](../../contracts/runtime-launch-and-verification-v19.md)。

### 后果

- 同名 CLI 不会被误启动，且旧 `cursor-agent` 安装仍可被明确识别；
- 产品可提前完成数据和 UI identity 收口，却不会向用户承诺当前平台可用；
- Catalog 数量不再等同于当前平台可执行数量，所有普通动作必须持续消费 Admission；
- 未来 Cursor build version shape 改变时，发现会保守失败，需用新证据更新 identity parser；
- 完整登录/行为 Smoke 被明确推迟到新的 qualification 交付，不会污染本版证据。

### 被拒绝方案

- **直接把 `agent` 作为 canonical command：** 会与已安装 Grok Build 碰撞，basename 无法提供产品身份；
- **只保留 Settings Preview：** 无法建立稳定 Adapter/Migration identity，也不能提前验证 closed-set 完整性；
- **initialize 成功后直接标记 macOS qualified：** 违反 checklist 的认证、Session、Tool、Approval、取消、
  cleanup 与 Built-in CLI 必过条件；
- **在代码中实现 Cursor 但完全不进入 Catalog：** 会形成无法由 Contracts/Migration/UI 共同审计的隐藏
  Adapter，并破坏 closed catalog 不变量。
