---
document_type: contract
name: Runtime Launch and Verification
version: v79
status: accepted
source_version: v1.72
last_updated: 2026-11-09
---

# Runtime Launch and Verification v79

继承 [v78](runtime-launch-and-verification-v78.md)，补齐 Kilo 的原生配置、来源与生命周期语义。
[已确认 R1](../versions/v1.72/model-context-change-kilo-acp.md)的 B/P、输入位置、预算、formatter 和证据版本保持。

## Kilo 原生配置与权限

Kilo inline 配置的所有对象保留原始键顺序，包括嵌套 permission pattern 与 Agent 规则；
不启用全 workspace 的 JSON preserve-order，不把原生权限转换成另一套 Core 决策。
原生文件、inline、`KILO_PERMISSION` 与用户插件仍由 Kilo 加载、合并。

当前 Kilo 合并会保留较早对象的键位置；仅把新增 wildcard 放在 inline 开头，不能保证文件中的具体规则继续生效。
因此 Host 私有目录追加一个无依赖的原生 `config` 回调：在原生合并及用户配置回调完成后，将成员保存的
wildcard `allow / ask / deny` 放在具体规则之前，并固定 question 为 deny；其余规则及相对顺序保持。
用户 Agent 自己的规则继续按原生语义生效。该回调只设置原生配置，没有工具、审批、压缩、模型输入或握手逻辑。
Bootstrap 仍只通过 v78 instructions 文件进入普通模型请求；不注册压缩观察插件。

## Host 与 MCP

实际 affected-members 的 MCP mutation 同时 invalidates Kilo 的共享 Fleet Host：idle 立即停止，
busy 保持本轮并在正常收口后停止。相同 Binding 的不兼容进程先沿共享退役入口回收，再创建替代 Host。
恢复保留完整原生 Session ID；A → B → A 不能再次领取已退役的旧 A。

ACP stdio 没有 cwd 字段。Kilo 与 Command Code 共用现有 argv launcher，仅在显式 MCP cwd 与 Session cwd
不同时改变 Server 子进程工作目录；参数保持字面值。Command Code 的专用 placeholder 转义不应用于 Kilo。
不新增进程池、配置镜像或 MCP 生命周期服务。

## 模型、认证与原生来源

- Kilo 原生思考选项 ID 为 `effort`。目录、UI、持久化与 `session/set_config_option` 使用相同 ID；
  选项仅归属实际广告它的当前模型，不复制到未观察的模型，不把旧 `reasoning_effort` 猜成 alias。
- initialize/session-new 只证明连接及目录可用。无模型凭据验证证据时，authentication 保持 `unknown`；
  不能由非生成探测升级为 authenticated。既有执行准入与延迟验证保持。
- numeric reader 从实际 Host 的冻结启动环境解析 `KILO_DB`：绝对路径直接使用，相对路径基于原生 Kilo data 根，
  缺省为 data 根下 kilo.db；`:memory:` 没有磁盘观察来源，保持未知，不回退猜测 Session 累计值。
- Kilo 原生 Skills 静态候选包括默认 XDG config/kilo、Home 的 `.kilo`/`.kilocode`，以及追加的
  `KILO_CONFIG_DIR`；这些目录的 `skill`、`skills` 均保留。项目对应目录及 `.agents`/`.claude` 来源复用共享扫描、去重与缓存。

macOS arm64 Preview 范围保持。真实版本与验证边界见[复核记录](../versions/v1.72/kilo-acp-review-fixes.md)。
Steer 的原生研究不自动开放 Core active-input，见[Steer 证据](../research/kilo-runtime/steer-7.8.27.md)。
