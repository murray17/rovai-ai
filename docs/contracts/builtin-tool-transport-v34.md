---
document_type: protocol-contract
contract: builtin-tool-transport-v34
authority: builtin-tool-transport
status: accepted
version: 34
last_updated: 2026-10-02
---

# Built-in Tool Transport v34

继承 [v33](builtin-tool-transport-v33.md) 的操作、IPC 2、Envelope 1、receipt 1、授权、运输与幂等规则。
Contract／CLI 为 34，Agent Output 为 7，Runtime capability 为 `builtin_cli.transport.v34`。

通知的主 flag 为 `--to-user`，`--to-principal` 保留为隐式兼容别名，两者均归一为 `mentionUser`。
同一次调用提供两个拼写按重复参数拒绝。目录、帮助与新 Agent 输出使用 User；普通 Text、引用与旧成功回执不改写。
结构化用户提及、搜索和冻结证据规则见 [User Naming v1](user-naming-v1.md)。

目录变化不进入 Native Binding 的兼容身份；Antigravity 仍使用固定 version 32 与原 digest。
旧 Bootstrap 的命令继续可执行，安装包更新沿原路径同步 Skill，无需轮换 Session。
