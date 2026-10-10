---
document_type: model-context-change
version: v1.72
change_id: cline-system-bootstrap
revision: 2
confirmation_status: confirmed
confirmed_by: User (Thread messages 144d1d46-1ceb-4975-a8de-0b6d08f93c65 and f80961bc-8447-42f1-83e0-a1f02b8107b9)
confirmed_revision: 2
confirmed_at: 2026-10-06
authority: model-input-change-statement
implementation_status: implemented
last_updated: 2026-10-06
---

# Cline 官方 ACP：System Rule revision 2

User 在已讨论 Rule/System 方案后明确要求不再以故意缺失插件的极端测试阻挡实施，并再次要求继续。
本记录取代[旧研究提案](../../research/cline-runtime/model-context-change-v1.70-proposal.md)中
required-plugin readiness 作为交付前提的部分；正常部署、加载、Session 绑定与真实调用仍必须验证。
不将此确认扩大为 First-Class、上游压缩能力或另一套 SDK Host 的授权。

## 变更前

`B` 是 Native Binding 冻结的完整 Bootstrap；`P` 是本 AgentRun 冻结的完整 Dynamic Context。
Cline 为 `first_payload`：首次 user 文本为 `B + "\n\n" + P`，正常 warm/exact cold 为 `P`；
有合格 pending redelivery 时，原冻结 B 经共享 envelope 进入下一 user 输入。

## 变更后

采用现有 `managed_system_prompt`。Host 私有官方 Plugin manifest 加载受管 Rule 文件；
每次 `setup(api, context)` 捕获自己的完整 `context.session.sessionId`，注册唯一 Rule：

```javascript
api.registerRule({
  id: "rovai.session.bootstrap",
  source: "plugin",
  content: () => verifiedFrozenBootstrapForThisSession,
});
```

返回值精确为冻结 B，不增添包装、说明或新 section。Cline 自己组合原生 System 和 Rule；Rovai 不替换
原生 System，不改项目或用户规则。绑定文件 shape 为
`{schemaVersion:1, sessionId:string, bootstrap:string, sha256:string}`，文件名是 Session ID 的 SHA-256。
Core 冻结上下文及绑定 generation 后原子写入；同一 Session 再绑定只能字节相同。Rule 校验完整 ID、摘要、
非空和 B 的 32 KiB 预算。B 选择独立于 Prompt lease，避免 cold load 的提前初始化丢失身份；数值 observer
继续依赖每 Prompt 的独立 lease，不借此开放跨 Run 数据。

| 时机 | 先前 user 文本 | 当前 user 文本 | 当前 System |
| --- | --- | --- | --- |
| 首次 | `B + "\n\n" + P` | `P` | 原生 System + 唯一冻结 B |
| warm / A→B→A | `P` | `P` | 目标 Session 的 B |
| 新 Host exact cold | `P` | `P` | Core 重新绑定的原 B |
| 替代 Session | 新 Binding 的 `B + "\n\n" + P` | `P` | 新 Binding 的 B |

## 明确不变

B 的 SESSION_CHARTER、MEMBER_IDENTITY、ROVAI_PLATFORM_SKILLS、条件成立时 MEMORY_ENTRYPOINT
正文/顺序/条件不变。P 的 Run facts、工作项、Workspace、协作状态、Skill/MCP 和附件选择、字段、遗漏与预算
不变；仍由现行 formatter 和 ContextManifest 拥有。`runtime_payload` 及其摘要现在只绑定 P，Bootstrap
evidence 独立绑定 B；无新公共字段、Schema 迁移或共享 formatter/profile 版本。

Bootstrap profile `cline-system-rule-v1` 纳入原生配置 digest。旧 first_payload Binding 经现有 compatibility
fence 旋转一次，不能假称跨交付模式 exact resume；新 profile 内的 warm/cold 保持原 Session/Binding/generation。
已发送且接受结果未知的输入不重投。补发 detector 默认 disabled，启动 reconciliation 保留以废止旧 epoch；
不向普通 user history 重复注入 B。原生数值压缩事件解析仍保留，但不广告压缩已可用。

## 验证与接受边界

Node owner 覆盖同一模块内 A/B/A、重复 setup；Rust owner 覆盖私有 manifest、双 Session 冻结与拒绝改写。
真实 3.0.65 ACP 在 beforeModel 的 System 中 A/B 各恰好一次，所有 user 消息中均为零；同 PID 切换与新 PID
exact cold 均返回正确身份和早期记忆。产品包验证与指标记录见[本轮验收](../../research/runtime-monitoring/command-cline-native-system-2026-10-06.md)。

官方可选 Plugin loader 的缺失后继续行为仍存在，本 revision 按 User 指示不以故意删除受管文件作为阻挡项；
不声称新增 required-plugin 门禁。官方 ACP 未传 SDK compaction.enabled，System Rule 并不能启用压缩引擎；
manual/threshold/overflow 连续性仍不计通过。此轮不切换第三方桥、不补丁修改上游可执行文件。

## 二次确认

本 revision 2 已由 User 确认。消息 `144d1d46-1ceb-4975-a8de-0b6d08f93c65` 在 System Rule
方案及缺失 Plugin 反例讨论后明确要求“不考虑极端”；消息 `f80961bc-8447-42f1-83e0-a1f02b8107b9`
再次要求继续原生 MCP 并尽可能验收。确认覆盖这里说明的 Cline System Rule 主路径和相应兼容 fence；
本轮不再请求相同许可。以后若改变 B/P 字节、来源、位置或时机，继续按现行上下文治理递增说明。
