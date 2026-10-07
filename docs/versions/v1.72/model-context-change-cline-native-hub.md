---
document_type: model-context-change
version: v1.72
change_id: cline-native-hub
revision: 1
confirmation_status: confirmed
confirmed_by: User (Thread message c023f19a-9f1c-4558-b4d4-1bbab3ddffe9, sequence 80)
confirmed_revision: 1
confirmed_at: 2026-10-07
authority: model-input-change-statement
implementation_status: implemented
last_updated: 2026-10-07
---

# Cline Native Hub：冻结 System Bootstrap 与原生压缩

## 变更前

[Cline ACP revision 2](model-context-change-cline-system.md)由 Plugin registerRule 返回 Native Binding
冻结的完整 Bootstrap `B`，首次及 warm/cold 的 user input 为当前 Run 的动态输入 `P`。
实际安装 3.0.3 为编译二进制，不能用另一份 SDK 的 shim 证明其 ACP/Core 配置已注入。
原生 Hub 最小验证已经证明 sessionConfig.compaction 与同后端 cold，尚无产品 Adapter。

## 变更后

新 Binding 冻结 `cline-hub-v1`，只启动所选官方 CLI 的独立认证 Hub。仍由现有 formatter、Context
和 Binding 服务提供不透明 B/P。没有第二份 Charter、成员字段、工具教学目录或平台 Skill catalog。

每个 Host 的原生 `.cline/rules/rovai-managed-<B digest>.md` 内容精确为：

```text
<!-- Rovai frozen native Rule -->
<B 原始字节>
<!-- End Rovai frozen native Rule -->
```

即 `"<!-- Rovai frozen native Rule -->\n" + B + "\n<!-- End Rovai frozen native Rule -->\n"`。
注释用于保护 B 的首尾空白不被原生文件 Rule reader 的 trim 去除，不含新的模型行为指令。
原生 Cline 拥有 System 的组合；root beforeModel 只读检查 B 恰好出现一次，不改写请求。
Host 固定 B，原生用户 Rules 作私有快照、项目规则仍由原生发现。不同 B 不能共用该 Host。
每轮 `run.start.payload` 为 `{prompt:P, mode:冻结原生 act/plan}`；不追加 B 到 user history。

| 时机 | user 文本 | System Bootstrap | Session / Binding |
| --- | --- | --- | --- |
| 新 Hub Binding | P | 文件 Rule 中原冻结 B 一次 | 新完整原生 ID |
| warm / A→B→A | P | 各自 Host 原 B | 保留完整 ID、Binding 和 generation |
| 同后端 cold | 新 Run 的 P | 新 Host 重新提供原 B | 原生 get/messages → create，同完整 ID |
| 原生 basic/agentic 压缩后 | P | 原 B，未由 Rovai 补发 | 原生历史与恢复逻辑拥有压缩结果 |
| 旧 ACP Binding | 保持原 ACP 的 P | 保持 revision 2 Rule | 不转换或自动迁移 |

原生配置明确关闭时传 `{enabled:false}`；明确 basic/agentic 时传原生策略；未设置时读取所选 CLI
help 的实际默认。无效类型、未知策略或无法验证的默认关闭启动，不静默启用。没有 compaction
client contribution、自写压缩、模型总结替代、/compact 产品命令或未知输入重发。

## 明确不变

SESSION_CHARTER、MEMBER_IDENTITY、MEMORY_ENTRYPOINT、平台 Skills 的正文、选择和顺序保持 B
的原值；P 的 Run Facts、Workspace、协作状态、输入工作项、附件和预算仍由现行共享服务拥有。
Bootstrap evidence 绑定 B，Runtime input evidence 绑定 P。共享 formatter/profile/manifest 版本、
数据库 schema 和 Built-in 操作目录不变；新增内部 transport 协议参与 compatibility digest。
原生 Rule 的外层注释属于文件运输层，不能用它伪造另一个 Bootstrap digest。

## 兼容与失败路径

已有 ACP 从其 Binding 对应的冻结 AgentRun 取回后端；缺少后端证据拒绝恢复。preflight 不将旧
Run 改为 Hub。同后端 cold 必须读取精确 ID 的原生 metadata/messages，并将 messages 原样交回
原生 create；不生成摘要或改变 Session ID。缺历史、身份不匹配、配置无法解析均关闭该次启动。
新输入必须是共享 prepared delivery；原生 beforeRun 才确认接受，连接中断后不自动重发。

## 验证

纯配置 parser 拥有 off/basic/agentic、未知与非法设置矩阵；共享 missing-send owner 验证按冻结
后端匹配。真实 opt-in Hub Smoke 检查正常 Rule、原生审批拒绝、稀疏 Usage 和清理；隔离 Core
fixture 按实际发送回执验证 first/A→B→A/cold，不能以最终文本补发替代 builtin send。
阈值压缩的此前同安装证据不外推到 overflow/retry 或完整平台资格。最新执行结果见
[Hub 产品矩阵](../../research/cline-runtime/hub-adapter-implementation.md)。

## 二次确认

User 在消息 76 定义 Native Hub 方案及安装/压缩/后端边界，已阅读消息 79 的原生验证结果；
消息 80 明确要求“把 cline 改为这一套”，完成后推送远端并列出 Runtime 差异。此次直接实施指令
授权该 Native Hub 交付，不要求再次确认相同方案。文件记录运输细节，未改变 B/P 的产品语义。
