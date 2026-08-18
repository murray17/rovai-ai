---
document_type: contract
name: Runtime Launch and Verification
version: v9
status: accepted
source_version: v1.11
last_updated: 2026-08-18
---

# Runtime Launch and Verification v9

本合同完整继承 [v8](runtime-launch-and-verification-v8.md) 的 purpose-scoped launch、Availability、
execution-deferred verification、TRAE continuation/HistoryRestore、公开 Runtime failure 与 fencing，并增加
统一模型目录缓存和 AgentRun 最终模型验证。v9 不新增 Migration；Data Contract 保持 `v1.10`、projection
schema 50、migration 95。

## 1. Model catalog cache

`AdapterInstallation` additive 暴露：

```ts
type RuntimeModelCatalogCacheStatus =
  | 'fresh'
  | 'stale'
  | 'expired'
  | 'unavailable'
  | 'invalidated'

interface RuntimeModelCatalogCache {
  status: RuntimeModelCatalogCacheStatus
  observedAt: string | null
  revalidateAfter: string | null
  expiresAt: string | null
}
```

只有成功的 deep probe `ready` snapshot 构成模型目录成功证据。`light_ready`、`installed_unverified`、失败
attempt、缺失或无法解析的成功时间均不构成可服务目录。成功目录从 `lastSuccessfulProbeAt` 起 `<60s` 为
`fresh`，`>=60s && <24h` 为 `stale`，`>=24h` 为 `expired`。snapshot 已被确定变化标记 stale 时为
`invalidated`。

`fresh|stale` 可以服务 snapshot models；其他状态不得把 snapshot models 暴露为当前可选目录。
`revalidateAfter` 与 `expiresAt` 只在可解析的成功目录上计算。缓存年龄按 Core UTC 时间判断，Renderer 不自行
计算或延长 TTL。

## 2. Picker-open interface

Desktop allowlist 增加：

```ts
runtime.modelCatalog.open({ runtimeKind }): Promise<{
  runtimeKind: AdapterKind
  cache: RuntimeModelCatalogCache
  models: ModelDescriptor[]
  refreshStatus: 'not_required' | 'scheduled' | 'joined' | 'completed' | 'failed'
  diagnosticCode: string | null
}>
```

- 切换 Runtime 不调用该 interface，不启动 Runtime，也不触发 discovery；
- `fresh` 直接返回，不排队检查；
- `stale` 立即返回 last-known-good，并通过 Runtime Check Manager 单飞后台刷新；
- `expired|unavailable|invalidated` 等待一次 manager-owned Availability Check 后返回；
- 同一 Runtime 的并发 Picker、显式检查和执行刷新加入同一个 attempt；全局并发与 deadline 继续由 v8
  继承的 Check Manager 拥有。

后台或等待刷新失败不得改写最后成功 snapshot。最新 failed Probe Attempt 可以驱动“刷新失败，继续显示
上次成功结果”或重试提示，但不能把 failure 当成空 catalog。

## 3. Explicit availability check

`runtime.product.check` 是 force revalidate。Core 必须等待 manager attempt 的 success/failure/timeout/panic
终态后才完成请求；返回值至少包含 `scheduled=true`、`completed=true`、`ready` 与 `runtimeKind`。enqueue、
acknowledgement 或 manager supervision failure 不能被吞掉。

manager timeout/panic/join failure 在存在 Installation 时写入 transient failed Probe Attempt；该 attempt 保留
last-known-good，不使 Runtime 失败冒充目录失效。显式检查开始前不清空成功目录。

## 4. Invalidation

以下确定证据可以不等待 TTL 直接使模型目录 `invalidated`：

- executable fingerprint、canonical installation 或安装 generation 改变；
- Runtime 安装/升级或 capability snapshot 被确定替换；
- Adapter 能证明的认证、credential、account 或 Provider 配置 identity 改变；
- 用户显式执行检查/刷新时强制 revalidate，但 last-known-good 只在新结果成功后替换。

account/provider identity 只有稳定、非敏感、可比较的 Adapter evidence 才能自动失效；不得持久化 credential
内容，也不得从不稳定显示名、错误文本或路径猜测 identity。

## 5. Member configuration

`runtime_default` 与模型目录独立：只要 Runtime 与 permission 配置可保存，就可以保存
`{ mode: 'runtime_default' }`。冻结配置使用 Adapter 稳定 sentinel 作为内部审计 identity，但启动真实
Runtime 时不得发送显式 model 或调用 set-model。

新的 explicit selection 只能从未超过 24 小时且未失效的目录保存，并继续验证模型 options。正常既有
explicit selection 在目录不可用、过期或暂未包含它时保持原值，不自动改写或 fallback；Renderer 分别呈现
“当前目录未提供”“缓存中未找到”或“尚未核对”。

本合同不要求读取、迁移或修复人工修改、技术恢复或其他不受支持方式产生的损坏配置。

## 6. AgentRun final validation

缓存目录不是执行事实。真实 AgentRun 建立 Host/Session 后：

- Codex explicit model 必须通过该 Host 的完整 `model/list` 分页确认，再向 Thread/Turn 传 model；
- ACP explicit model 必须存在于真实 Session 返回的 model/config option catalog，再调用 set-model 或
  set-config-option；
- one-shot Runtime 继续由其真实进程对显式 model 参数给出 typed terminal/launch 结果；
- `runtime_default` 对所有 Runtime 均省略显式 model；
- 当前目录不存在保存值时返回 `runtime_model_unavailable`；真实目录无法读取或验证时返回
  `runtime_model_catalog_unavailable`；两者进入 `needs_attention`/不可执行路径，不创建替代 Session 来绕过，
  不静默 fallback。

## 7. TRAE and acceptance

TRAE 使用同一 cache status、Picker-open、60 秒/24 小时、Availability Check、失败保留和 AgentRun 验证合同。
ADR-0208 的 purpose-scoped 启动限制仍有效：Picker 只通过用户打开动作授权的 Availability Check，不把普通
页面进入或 Runtime 切换变成启动。

需要启动真实 TRAE 的 acceptance/smoke 必须串行执行，避免多个本机进程竞争第三方密钥或状态文件。测试
串行化不是 Runtime wire 或产品状态分支。

## 8. Acceptance

- fresh/stale/expired/unavailable/invalidated 在 60 秒和 24 小时边界可重复验证；
- stale Picker 即时显示 LKG，后台刷新成功替换 snapshot，失败保留 LKG 并留下 failed attempt；
- 无缓存 Picker 等待 discovery；Runtime 切换不产生 Runtime process；
- 显式检查请求等待真实终态，manager timeout/panic 不再只写内存诊断；
- 既有已保存模型在无目录时显示“尚未核对”，不是“已失效”；
- runtime default 在无目录时可保存/冻结，且 Codex、ACP、Claude、Antigravity 均不收到显式 sentinel；
- ACP/Codex 真实目录缺少 explicit model 时 typed fail closed，不创建 silent fallback；
- TRAE 产品行为使用统一合同，真实进程用例串行执行。

## References

- [Runtime Launch and Verification v8（历史）](runtime-launch-and-verification-v8.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0127](../adr/0127-atomic-member-runtime-configuration.md)
- [ADR-0192](../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
- [ADR-0204](../adr/0204-on-demand-runtime-deep-verification.md)
- [ADR-0208](../adr/0208-user-authorized-trae-light-and-availability-verification.md)
- [ADR-0220](../adr/0220-runtime-model-catalog-stale-while-revalidate.md)
- [v1.11 版本范围](../versions/v1.11/README.md)
