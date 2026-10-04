---
document_type: protocol-contract
contract: thread-naming-v1
authority: public-thread-naming
status: accepted
version: 1
last_updated: 2026-10-01
---

# Thread Naming v1

公开会话统一称 **Thread**，中文继续用“对话”。本合同覆盖既有 Camp 合同的公开命名；那些合同的业务规则、历史文件名与物理存储名保持。内部每位队员的 Conversation、Single Chat 的私有 `conversationId`、供应商自己的 Thread/Session 不属于这次替换，也不作为 Agent 可操作对象介绍。

| 公开接口 | 当前名称 | 旧输入兼容 |
| --- | --- | --- |
| 范围／集合 | `threadId`、`threadIds`、`threadTitle`、`threads` | 对应 `campId`、`campIds` 等既有输入 |
| 消息／回合 | `ThreadMessage`、`ThreadTurn`、`threadMessageId`、`threadTurnId` | 旧已存结果先验身份，再投影新名 |
| Agent CLI | `rovai thread list\|search\|read` | `rovai camp` |
| User CLI | `rovai app thread create\|send\|open` | `rovai app camp` |
| 读取回复链 | `--reply-chain`／`replyChain` | read 的 `--thread`／`thread` |
| trace 范围 | `--thread-id`、`--exclude-thread-id` | 旧 camp 拼写 |

新结果只输出新名称，Read Model snapshot schema 为 35。回复链结果是 `mode: "reply_chain"` 与 `replyChainRootMessageId`；锚点仍可为链内任意消息，分页和可见性不变。字段别名只在原来允许该字段的端点接受，新旧同义参数同时出现则拒绝；别名归一化后仍执行封闭 schema 和身份／权限检查。`rovai send` 仍由当前 Run 决定范围，不能接受 `threadId`、`campId` 或私有 `conversationId`。

旧命令名／参数参与幂等摘要的表示保持原样；同一个请求 ID 换一种合法拼写仍重放同一个结果。历史 command result、工具 envelope／receipt、审计事件、附件授权及引用快照先按原字节验摘要，再在各自拥有的字段边界投影；禁止递归改写任意正文或第三方 JSON。

Thread ID 保持 `rvcamp_` + UUIDv7 编码，既有 SQL 表／列、外键、目录、localStorage key 和附件路径不迁移。窗口位置、草稿、浏览历史、首次引导与已配置 trace 范围接受旧字段。原 main 的 Migration 178 / schema 128 已部署 Thread Context 格式。与已安装的指标分支收口后，保留指标 Migration 178/179 的数据和收据，Migration 180 将 schema 129 升至 130，为新 Context 格式扩展闭合准入。原 main schema 128 的精确布局通过 179/180 补建指标投影并收口；两条路径均不重写 Run、Native Binding、Bootstrap、历史输入或摘要。继续合入 User 命名和队员创建后由 181/182 升至 schema 132；原 main schema 129/130 的精确结构按执行指标合同原子收口。

旧 Native Binding 的兼容身份保持：Charter compatibility revision 16，其他 Runtime 启动身份不变；Antigravity 仍使用本次升级前工具兼容 version 32 与原目录 digest。新建 Binding 用 Charter 17；现有 Binding 的恢复／压缩补投读取其冻结 Charter，成员身份仍按既有更新规则处理。工具当前目录升级为 33，不以 live 目录改名强制换 Session。

Bundled Skills 沿用 [Skills Rebuild v1](skills-rebuild-v1.md) 的启动同步，在原路径更新为随包版本。旧 Bootstrap 里的 Skill 路径仍有效；已冻结投递的 Skill 索引不回写，新 Run 按新版本选取。Skill 名和权限不变。

上下文版本见 [ContextManifest v32](context-manifest-evidence-v32.md)，CLI 见 [Built-in Tool Transport v33](builtin-tool-transport-v33.md)。完整提示词和 Skill 前后文本见[确认稿 r2](../versions/v1.72/thread-rename-comparison.md)，理由见 [V1.72-D07](../versions/v1.72/decisions.md#v1-72-d07)。
