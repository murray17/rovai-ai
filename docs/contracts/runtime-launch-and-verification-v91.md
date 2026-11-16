---
document_type: contract
name: Runtime Launch and Verification
version: v91
status: accepted
source_version: v1.72
last_updated: 2026-11-14
---

# Runtime Launch and Verification v91

继承 [v90](runtime-launch-and-verification-v90.md)。本版收窄 Goose 的配置请求、探测会话与客户端历史回放；
Bootstrap、Dynamic Context、Manifest、实际原生会话历史、权限裁决、CLI 租约和平台资格不变。

## Goose 原生配置

Provider、model、thinking_effort 和 mode 使用现有 `session/set_config_option` 入口。
原生已报告相同选择时省略重复 setter；缺少当前值仍投递冻结选择，不从缺失状态推断一致。
Goose 的 config_option_update 更新已有 Host 会话快照，不增设配置缓存或状态机。
setter 成功但未返回选项快照时，旧快照失效，不能据此省略后续选择。
`provider=goose` 是恢复原生默认的操作，仍交由 Goose 重新解析当前默认配置。
mode 通过该接口调用同一个原生模式实现，保留 auto/approve/smart_approve、默认 auto 与原始审批选项。

## Goose Session 与 MCP

新建和正常兼容的同 Host 复用不查询 extensions/list；精确冷恢复后、业务 prompt 前仍使用
原生 list/remove 撤回已不适用的 Rovai 分配，保留用户原生扩展。配置适用性每轮沿共享入口计算并冻结，
不在保存时主动清理，不增加 dirty 标记、版本计数或 MCP 管理器。
不同 cwd 的 stdio MCP 继续使用已有 bundled Rovai 入口，远程 HTTP 不使用 cwd launcher。

Goose `session/load` 携带 `_meta.replayTail=1`，只减少发给客户端的历史回放，按原生 turn 边界截取。
不截断或改写原生会话，不减少模型可见历史；旧事件仍走共享恢复隔离与原有期限。
完整 B 仍每轮通过原生 keyed System RPC 替换，普通 prompt 仍只承载 P；没有新的模型输入版本轴。

目录、选项和完整探测如成功创建 Goose Session，结束时必须在原探测绝对期限内
用 `session/delete` 删除该次明确返回的 ID，包括后续选项查询失败的情况。
没有已知 ID 时不猜测或扫描；删除拒绝或超时必须如实报告清理失败，再沿共享路径回收探测进程。
不删除已有用户会话，不新增后台清理器或探测数据库 reader。

## Skills 管理与原生成本

平台和工具箱 Skills 继续使用共享真实路径索引，不因 Goose 新建项目投影。
管理页的 nativeSkills.list/read 沿用户级原生发现入口支持 `~/.agents/skills`；项目路径继续由 Thread 候选发现，
同时保留 `.goose/skills`、`.claude/skills` 与原生用户目录。验证标签不替代具体入口的实测事实。

Goose 原生会话库、模型目录缓存和原生请求日志继续由官方 CLI 管理；不声称零写盘。
不为取消原生日志新增 Rovai 文件清理、日志服务或修改官方程序。
官方程序、受控 Provider 和 UI 夹具的证据边界见[实施记录](../versions/v1.72/goose-acp-implementation.md)。
