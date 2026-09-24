---
document_type: interface-contract
contract: collaboration-state
version: 3
authority: agentrun-peer-routing-identity-projection
status: accepted
last_updated: 2026-09-23
---

# Collaboration State v3

继承 [v2](collaboration-state-v2.md) 的 current CampMember 选择、peer 顺序、Lead 关系、完整投影
digest 与 accepted ACK。新模型正文的完整结构为：

```json
{
  "peers": [{
    "agentId": "agent_2",
    "name": "Peer",
    "teamRole": "Reviewer",
    "professionalResponsibilities": "Reviews the requested change."
  }],
  "defaultLeadAgentId": "agent_1",
  "selfIsDefaultLead": true
}
```

顶层无 `schemaVersion` 或替代协议标记。`peers` 可为空；其余两个字段仍必有。模型可见
`MEMBER_IDENTITY` 是唯一 self 身份投影，本结构不能覆盖 self 身份。内部证据和协议版本不进入正文。
