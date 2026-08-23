---
document_type: protocol-contract
contract: first-run-onboarding-v2
authority: desktop-first-run-state-provisioning-deferral-and-draft-entry
status: accepted
version: 2
last_updated: 2026-08-23
---

# First-run Onboarding v2 Contract

本合同替代 [v1](first-run-onboarding-v1.md) 作为当前入口。v1 的首次安装判定、逐页持久化、幂等
provisioning 和“初次集结”语义保持有效；v2 增加无可用 Runtime 时无产品副作用地结束训练营，并把
Desktop 状态文件升级为 schema 2。

## 1. Admission and ownership

Electron Main 在 Core 启动创建 `rovai.sqlite` 前决定首次安装 admission。没有持久 onboarding 状态且没有
当前或旧产品数据库时，Main 原子写入 `in_progress(welcome)`；已有产品数据时写入
`completed(existing_installation)`。已持久的 `in_progress` 或 `completed` 始终优先于数据库存在性。

状态只存在于私有 Desktop 文件 `onboarding.json`，不进入 SQLite、Renderer storage、Navigation、Memory
或 Agent context。写入串行、原子且权限为 `0600`。Preload 只暴露封闭读取与转移，Renderer 不能初始化或
直接解释状态文件。

## 2. Schema 2 snapshot union

每个当前对象都是 exact-key 的 `schemaVersion: 2` 封闭联合：

```ts
type OnboardingSnapshot =
  | { schemaVersion: 2; status: 'uninitialized' }
  | {
      schemaVersion: 2
      status: 'in_progress'
      step: 'welcome' | 'member' | 'runtime'
      selectedMemberRole: BuiltinMemberAvatarRole | null
      runtimeSelection: {
        adapterKind: AdapterKind
        model: ModelSelection | null
      } | null
      provisioning: OnboardingProvisioningOperation | null
    }
  | {
      schemaVersion: 2
      status: 'completed'
      origin: 'onboarding' | 'runtime_deferred' | 'existing_installation'
      completedAt: string
      selectedMemberRole: BuiltinMemberAvatarRole | null
      memberAgentId: string | null
      quickChatCampId: string | null
    }
```

`origin = "onboarding"` 要求三个最终身份全部非空；`runtime_deferred` 与 `existing_installation` 要求三个
身份全部为 `null`。Main 启动后不向 Renderer 暴露 `uninitialized`。

合法 schema 1 snapshot 在读取时确定性规范化为 schema 2，保持原状态、步骤、选择、provisioning 检查点和
完成来源；schema 1 不接受 `runtime_deferred`。新写入只产生 schema 2，不双写旧格式。

## 3. Pages and Runtime result branching

`welcome -> member -> runtime` 仍是进入 Runtime 页前的强制顺序，不存在绕过 Welcome 或 Member 的 Skip，
也没有可跳转步骤条。Provisioning 开始前，Back 只回到紧邻前页。每次选择与页面转移在返回 Renderer 前先
持久化，重启恢复精确未完成页。

Runtime 页运行真实 discovery、平台准入、Availability 与 managed Installation 读取。扫描中的页面继续展示
真实阶段；扫描结束后：

- 至少一个 Runtime 同时满足当前平台 `qualified`、产品状态 `available`、匹配的
  `managed_default/default-auth` Installation、Adapter-owned member defaults 和可保存模型选择时，保留
  Runtime/model 选择与正常 provisioning；
- 可直接继续的 Runtime 数量为零，或本轮扫描失败/超时而没有形成可靠可用结果时，统一显示
  “当前没有可用的 Agent 运行时”；没有第二个“扫描失败”产品页；
- 空结果页允许重新扫描。重新扫描立即回到真实扫描状态，不复用空结果冒充新结论。

Renderer 只在上述空结果投影中显示结束训练营动作。Main 的 `deferRuntimeSetup` 仍强制当前状态必须是
`in_progress(runtime)` 且 `provisioning = null`；一旦 provisioning 开始，不能转入无副作用完成分支。

Runtime 页正常分支仍只持久 `adapterKind` 与 `model`，不展示 Runtime 权限。Provisioning 必须复制所选
managed Installation 的精确 `memberRuntimeDefaults.permissions`，缺失或不匹配时 fail closed。

## 4. Idempotent configured provisioning

正常分支沿用 v1 的 checkpointed saga。`beginProvisioning` 在任何 Core mutation 前持久三个 UUID command ID、
冻结的 Adapter 权限和 nullable checkpoints，随后依次：

1. 保留所选预设对应的 seeded profile；缺失时以 `memberCommandId` 创建；
2. 以 exact member version 和 `runtimeCommandId` 保存模型及冻结权限；
3. 以 `campCommandId` 创建唯一 Active Quick Chat Camp `初次集结`，只含该成员并设为 Default Lead；
4. 先提交 `{ kind: "camp", campId }` 为可恢复位置；
5. 写入 `completed(onboarding)`。

每个成功副作用先 checkpoint 再进入下一阶段；重试复用冻结 command ID 和权限并跳过已有阶段。完成前必须
同时存在全部 checkpoint 与 Camp restore target。

## 5. Runtime-deferred completion

用户在空结果页选择“进入 Rovai”时，Main 原子写入：

```ts
{
  schemaVersion: 2,
  status: 'completed',
  origin: 'runtime_deferred',
  completedAt,
  selectedMemberRole: null,
  memberAgentId: null,
  quickChatCampId: null
}
```

该转移不调用成员创建/保留命令、不保存成员 Runtime、不创建 Camp/Conversation/Message/Turn/AgentRun，
也不提交 onboarding 专属 restorable Camp location。之前在 Member 页选择的预设只是未物化草稿，不进入完成
身份。完成后正常 App Shell 接管；用户以后从设置或队员工作区配置 Runtime，启动不会再次进入训练营。

## 6. Configured fourth page

只有 `completed(onboarding)` 拥有真实第四页：普通 App Shell 中的 Active Quick Chat `初次集结`。无消息、
无 AgentRun 时展示三条 starter；选择 starter 只替换并持久化 Composer Draft、聚焦末尾，不产生消息、Run、
Skill 或 Runtime input。`runtime_deferred` 没有合成第四页或 starter。

## 7. Failure and recovery

- 页面 1–3 崩溃恢复精确持久页；Runtime 空结果本身不是持久步骤，重启后重新执行真实扫描；
- configured provisioning 崩溃从首个缺失 checkpoint 恢复，不能改走 `runtime_deferred`；
- `deferRuntimeSetup` 写入失败时保持 `in_progress(runtime)`，Renderer 显示可重试错误；
- `runtime_deferred` 一旦持久化即为终态，重启不再打开训练营；
- 已有 schema 1 completed/in-progress 数据不重建产品对象，也不丢失 provisioning checkpoints；
- 升级安装继续 grandfather 为 `completed(existing_installation)`，不重写历史产品数据。

## References

- [First-run Onboarding 架构](../architecture/first-run-onboarding.md)
- [首次训练 UI](../ui/components/first-run-onboarding.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Camp Composer Draft v2](camp-composer-draft-v2.md)
- [V1.27-D08](../versions/v1.27/decisions.md#v1-27-d08)
