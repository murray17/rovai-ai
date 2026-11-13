---
document_type: model-context-change
version: v1.72
change_id: goose-acp-system-bootstrap
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User (Thread sequence 117, message 94ecfa7f-9d45-4579-8bf3-3c6747a4ad23)
confirmed_at: 2026-11-13T12:21:16Z
authority: confirmed-model-input-change-statement
implementation_status: in_progress
last_updated: 2026-11-13
---

# Goose 官方 ACP 模型输入 R1

从已展示并由 User sequence 117 确认的[实施提案 R1](goose-acp-proposal.md)提取完整输入说明。
本文件先于产品实现建立；实际版本与证据在实施后追加，不重写已确认的输入语义。

## 变更前

当前 Core Runtime 闭集没有 `goose-cli`，不会向 Goose 投递任何 Rovai Bootstrap 或 Dynamic Context。
相邻的 Kilo managed-system 路由通过原生 instructions 文件交付 B；MiniMax/DSH 等保留各自既有路由。
本次只增加 Goose，不变更已有 Runtime 的这些输入。

定义：

- B：共享 ContextService 为本 Run/Native Binding 准备并冻结的完整 `bootstrap.payload` UTF-8 字节。
- P：共享 ContextManifest/Delivery 冻结的 Dynamic Context UTF-8 字节；不重新选择历史、不重新格式化。
- S：共享 Binding 保存的精确 Goose nativeSessionId；不解析日期或截短。
- N：Goose 自己的 base System、用户原生规则、工具描述、时间／cwd turn-context 和其他原生内容。
- K：固定原生追加键 `rovai-session-bootstrap`；只用于替换本 Session 的这一项，不作为证据校验码。

## 变更后

仅为新 identity 选择现有 `managed_system_prompt` 模式，并使用以下原生 RPC 承载。
尖括号表示原有冻结值的完整字符串，不是要写入模型的占位说明。

**每个普通 Run 的准备阶段，在 Host 归属本 Run 且旧 Run 静止后：**

```json
{
  "method": "_goose/unstable/session/system-prompt/set",
  "params": {
    "sessionId": "<S>",
    "mode": "append",
    "key": "rovai-session-bootstrap",
    "text": "<B>"
  }
}
```

等待同一 RPC 的成功 result `{}`，再投递业务输入。错误、超时或连接中断沿共享准备失败路径处理，
不得回落为把 B 塞入 user 历史或在准备失败后继续发送 P。
不调用 mode=set，不清空或重排原生其他 System 项，不改写用户原生配置文件。
追加指令的展示包装和原生 Unicode tag 清理由 Goose 拥有；Rovai 发送层保持 B 原字节。

**普通业务输入：**

```json
{
  "method": "session/prompt",
  "params": {
    "sessionId": "<S>",
    "prompt": [{"type": "text", "text": "<P>"}]
  }
}
```

不在 prompt 里再拼一次 B，不加入 `/auto-approve`、伪用户请求、Goose 专属模板或承诺文本。
现有附件／内容块转换及访问规则继续由共享 owner 处理；这里的文本块为冻结 Dynamic Context。

| 时点 | 精确行为 |
| --- | --- |
| new Session | 原生 new 成功后设置 K=B，成功后发 P；首次输入不是 B+P |
| warm Run | 旧 Run 已隔离后以本 Run 的 B 替换同一个 K；不因 B 正文变化重启 Host |
| exact cold load | 用保存的 S 和数据根加载原 Session，隔离原生历史回放；发 P 前再设置当前 K=B |
| 自动阈值／overflow 压缩 | 由原生执行；后续普通业务生成继续使用 Session 的 K，不向 user 历史重补 B |
| 原生摘要／标题／子代理 | 各自 System 由 Goose 拥有；不承诺包含父 B，不把它们改成 Rovai 新成员 |
| 新普通 Run | 使用新的 Run/epoch/CLI lease、本轮冻结 B/P；不继承旧 Run 授权 |
| accepted／unknown 恢复 | 按共享 Delivery 保留事实，不重新发送原 P 或补充 P |

B 的 section shape 完整沿用现行 formatter；以下正文槽位由共享代码返回，不由 Goose 层重建：

```text
[SESSION_CHARTER]
<现有 Charter 原文>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
<现有本人身份 JSON>
[/MEMBER_IDENTITY]

[TEAM_GUIDANCE]
<仅现行来源非空时出现的团队指引原文>
[/TEAM_GUIDANCE]

[ROVAI_PLATFORM_SKILLS]
<现有平台 Skill 索引>
[/ROVAI_PLATFORM_SKILLS]

[MEMORY_ENTRYPOINT]
<仅现行来源非空时出现的记忆入口原文>
[/MEMORY_ENTRYPOINT]
```

TEAM_GUIDANCE／MEMORY_ENTRYPOINT 不成立时整个 section 省略，不留下占位文字。
P 的完整 shape、字段、省略、顺序、来源选择和预算沿现行
[ContextManifest v43/v44](../../contracts/context-manifest-evidence-v44.md)与
[Context Delivery Profile v15/v16](../../contracts/context-delivery-profile-v15.md)，没有 Goose 私有 JSON 字段。

**补充输入的承载：**

```json
{
  "method": "_goose/unstable/session/steer",
  "params": {
    "sessionId": "<S>",
    "expectedRunId": "<本 Run 观察到的原生 activeRunId>",
    "prompt": [{"type": "text", "text": "<共享机制冻结的补充 P>"}]
  }
}
```

只在原始输入已按共享规则接收、同 Run 原生 ID 明确且请求仍活动时可发送。
原生成功返回的 runId/messageId 绑定本次补充 Delivery，确认的是“Goose 已接纳”，不是“模型已处理完”。
RPC 写出不等于接收；错误、超时／断连、错 Run 或迟到回应继续既有 rejected／unknown／epoch 规则。
同一 messageId 的后续消费通知不再次记接收、不再次入队。不新增重试保活或后台回执追踪器。

## 明确不变的边界和版本轴

基线的 Bootstrap contract v6、Bootstrap formatter 6、Charter revision 26，普通 Formatter/Manifest 44、
public-batch Formatter/Manifest 43、Profile 16／public-batch 15 全部保持。
不以新增 Runtime 为由改变其他 Adapter 的兼容键或使合法旧 Binding／冻结输入／Manifest 失效。

B/P 的选择、排序、省略、预算、身份、Memory Entrypoint、附件、Current Input、Skill 及公共历史权威不变。
沿用共享 Bootstrap Evidence 和 Runtime Input Delivery Evidence；不增加 Goose checksum、装载回执或运行时正文核对。
必须材料超预算仍由共享准备拒绝，不截断 B，不私自压缩、摘要或另开模型调用。
Native setter ACK 只证明 API 调用成功；实际模型可见证据由隔离验收的 Provider 请求证明，不把 ACK 伪造为读入证明。

## 数据、迁移和恢复

确认后仅做新 Runtime 身份所需的闭集 Migration，编号和 schema 目标按实施时主线尾号分配，不预占。
不迁移／导入用户 Goose 历史，不写其他 Runtime 的配置或认证，不改写旧 Run 事件及审计。
原生数据根参与现有兼容性判断；准备变化只按共享机制更换不兼容 Host，再精确 load S。
缺少 S 或原生报告不存在时沿既有恢复失败路径；不能猜一个最近 Session 来继续。
如果实施需要改变上述任何字段、输入语义、证据或版本轴，必须提升本提案 revision 并重新确认。

## 二次确认

User 在已收到完整 R1 和简明说明后，于 Thread sequence 117（消息
`94ecfa7f-9d45-4579-8bf3-3c6747a4ad23`）明确要求“那你先开启wt来实现goose”。
本次按该指令确认 revision 1，继续使用已开启的 `rovai/goose-acp` worktree。
本记录不扩展已展示 R1 的模型输入范围；实施偏离时仍须递增 revision 并重新确认。

## 验证


1. R1 二次确认、独立模型输入说明和 Version Decision；按主线尾号增加闭集 identity。
2. 发现／版本／轻检查／平台状态，模型 Provider 路由及目标模型档位；原生 auth 与握手结论分离。
3. 共享 ACP/Fleet Session、B→setter ACK→P、initial acceptance、原生 Steer、精确恢复。
4. MCP 归属删除／cwd、原生 Skills 与共享索引、Tool/Diff/输出、前台子代理、Monitoring。
5. 扩展现有 Rust 测试 owner，完成 schema／恢复负向、准备失败零 P、wrong-run、历史隔离、
   累计基线／去重／压缩成本、文件单投影、7.5 KiB、MCP 撤销、迟到审批、超时与无假 ACK；遵守测试准入政策。
6. 独立官方 CLI/Core smoke：new/warm/exact cold/压缩后 cold、连续 Steer、取消及子代理取消后真实同 Host、
   新 CLI lease/epoch、公开 `rovai send` 唯一消息、Skill 实读及更新删除、MCP A→B→空与 A→B→A。
7. 自动阈值和 overflow 必须实际触发，不能拿手动 compact 替代；新旧共享 ACP 快慢取消和专属 Runtime 回归。
8. 配置完成的真实模型和独立开发 App 验收；macOS arm64 原生探测不代替真实 auth、Intel/Linux/Windows。
   按 [14 轴及 9 Flow](../../development/runtime-integration-checklist.md)分别收口，缺资格如实保留。

上述方案是 Research→实施输入，不把 Core Compatible 称为已完成接入。
需要提前开放的平台必须有新的当前 Version Decision 接受 Preview，不能借用 Kilo 的资格，也不新增常驻 UI 资格说明。

