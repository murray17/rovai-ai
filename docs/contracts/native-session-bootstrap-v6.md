---
document_type: protocol-contract
contract: native-session-bootstrap-v6
status: accepted
version: 6
source_version: v1.72
last_updated: 2026-11-02
---

# Native Session Bootstrap v6

在既有 Session Charter、Member Identity、Platform Skills、Memory Entrypoint 合同上，只增加可选的
Team 指引。确认的完整前后说明见 [R1](../versions/v1.72/model-context-change-team-guidance.md)。

## 唯一新增模型内容

```text
[TEAM_GUIDANCE]
<创建 Thread 时固定的非空用户指引原文>
[/TEAM_GUIDANCE]
```

位于 `MEMBER_IDENTITY` 后、`ROVAI_PLATFORM_SKILLS` 前；不附加标题、Team ID、版本、名单、队长或
解释性提示。内容边界为 [Team Templates v1](team-templates-v1.md) 的 10000 Unicode scalar。
Custom、历史 Thread、空白指引与 Single Chat 省略整个 section；不生成占位符。

## 来源、冻结与恢复

Core 在 Thread 创建事务固定文本，后续队员首次启动、续用 Bootstrap 与合法压缩补发都使用同一文本。
Team 修改、复制或删除不会重投递，也不会覆盖既有 Thread；无会话级指引编辑入口或更新命令。
指引只在 Bootstrap 通道交付，不进入 Dynamic Context、Steer、Run Facts 或 Collaboration State。
沿用现有 Runtime 新 Session、Resume、managed prompt、压缩补发矩阵；不承诺所有 Runtime 物理上只发送一次。

Claim 的 Bootstrap 内容与实际 UTF-8 字节预算包含指引；超预算按既有失败路径处理，不截断必需段。
已物化输入继续使用原始最终 Blob，accepted/unknown 业务输入不因升级或 Team 编辑重放。
v6 stable-component digest 包含指引；恢复从不可变 Thread 启动材料取得同一文本。
新 public claim 使用其既有冻结 Member Identity；其他路径沿既有读取与格式化规则，本功能不另建身份快照。

## 版本轴

Bootstrap contract `native_session_bootstrap_v6` / formatter **6**。Migration 213 保留旧 v3–v5 Evidence；
旧 v5 和冻结 claim 恢复继续成立，v5 stable digest 计算不变，旧 Evidence 不倒填 Team 指引。
现行 session charter **26**、binding compatibility **16**、public／non-batch Dynamic Manifest/formatter
**43/44**、Profile **15/16** 保持；完整动态合同见 [ContextManifest v44](context-manifest-evidence-v44.md)。

## Hermes 的 user 层投递例外

Hermes 复用本合同完整 B，按[Hermes Managed Runtime v1](hermes-managed-runtime-v1.md#session-与输入)
仅在首次、真实规则更新的普通输入前置投递；压缩不触发补发；不注入 system/developer，不读取或改写原生 personality/system overlay。
它以完整 B digest 和接受回执去重，并在既有输入账本引用包含完整规则的冻结 Managed Blob；
这是 [Hermes R2](../versions/v1.72/model-context-change-hermes-first-input.md) 确认的运输/证据例外，
不改变其他 Adapter、不改变 B 的 section/formatter 或 Team 指引的固定来源。

## 职责与正文容量

按[已确认 R2](../versions/v1.72/model-context-change-professional-responsibilities-30000.md)，职责保存上限为
30,000 Unicode scalar；Cline、Command Code 的 Bootstrap 正文上限为 **262,144 字节（256 KiB）**，
Command Code 内嵌 Mod 同步检查正文 UTF-8 大小，JSON 传输转义不等同于正文大小。
执行包默认仍为 256 KiB。新 public claim 保持冻结正文、实际封装和分隔符预留；旧 `message_delivery`
preflight 固定预留单独保持 128 KiB 加原封装，不与正文上限共用数值。独立系统通道按原语义分别检查。
字段可保存不保证组合输入可执行；必需输入超限拒绝准入，不截断职责。已保存资料、已提交消息及历史
冻结输入保留；编辑不触发补发或重建 Session，修改设置不能重新解释旧执行。缩短已冻结团队指引须新建对话。
section、formatter、Binding、Profile 和 Manifest 的现行版本均不因此递增，不新增迁移。
