---
document_type: contract
name: Runtime Launch and Verification
version: v90
status: accepted
source_version: v1.72
last_updated: 2026-11-13
---

# Runtime Launch and Verification v90

继承 [v89](runtime-launch-and-verification-v89.md)。本版新增官方完整 Goose CLI 的薄 ACP 适配。
已确认的输入正文与传递位置见 [Goose R1](../versions/v1.72/model-context-change-goose-acp.md)。

## Goose 入口、配置与会话

产品身份为 `goose-cli`，正式命令为 `goose acp`，显式入口覆盖为 `ROVAI_GOOSE_BIN`。
使用 Goose 自己的配置、认证和数据目录；不复制其他 Runtime 的凭据，不另装 `goose-acp`。
ACP 握手、`authenticate` 的空成功或模型目录成功都不证明 Provider 认证成功。
三种执行模式 `auto / approve / smart_approve` 通过原生 `session/set_mode` 设置，默认 `auto`。
模式和具体工具规则由 Goose 执行；实际原生审批保留原 option ID，经共享 Approval 展示与回传。
原生 `chat` 禁用所有工具，无法满足公开回复必须经 Built-in CLI 的合同，故不进入可执行模式选项。
不新增 Core 权限求值器，不向 MCP 声明交互式表单能力，不将问卷转换成自动批准。

共享 ACP/Fleet 为每个 Binding 管理一个 Host，复用共享有界 cleanup 和租约释放证明。
普通完成与确认隔离后的取消可以 Warm；异常、超时、失联或必须退役的场景按共享路径停止。
冷恢复只用保存的精确原生 ID 调用 `session/load`，加载历史与当前 Run 隔离。
未确认接收与已接收／unknown 仍遵守共享投递语义，不用最近会话猜测或重发原任务。

## Bootstrap 与 Steer

每个普通 Run 使用共享构建器冻结的完整 B 与 P，不改变 formatter 或 ContextManifest 轴。
在本 Run 取得所有权、旧 Run 静止后，先调用
`_goose/unstable/session/system-prompt/set`，参数为
`{sessionId, mode:"append", key:"rovai-session-bootstrap", text:B}`。
仅成功后发送普通 `session/prompt`，正文为 P。同 key 替换当前 B；不使用替换原生 base 的 `mode:set`。
Warm 与 exact cold load 均先设置当前 B。自动阈值与 overflow 压缩由 Goose 执行并保留 Session 的 keyed extra。
原生摘要、标题和 `delegate` 子代理各有自己的 System，不承诺继承父 B，也不伪造成另一位 Rovai 成员。

活动输入采用 `_goose/unstable/session/steer`，携带原生观察到的 `activeRunId` 作为 `expectedRunId`。
返回的相同 `runId` 与非空 `messageId` 才确认接收；不以本地写入或“尚未报错”确认。
复用现有 Run/epoch、RPC 关联、接受账本和错误恢复，不提交第二个 `session/prompt`。
普通 Run 继续等待原生终态；成功 Steer 不强制退役 Host。已测稳定版本为 1.59.0，Steer 下限为 1.59.0。

## 模型与 Skills

目录通过官方 `_goose/unstable/providers/list` 获取已配置且可用的 Provider/模型。
目录 ID 为 `providerId/modelId`，只按第一个 `/` 拆分，原生模型 ID 保持不透明。
目录不包含各模型完整 effort；使用既有 MiniMax/DSH 目标模型查询队列、缓存和表单，按需切换 Provider、model 并读取 `thinking_effort`。
不扫描全部模型，不推测固定档位。正式执行先设 Provider/model，再设置原生 effort；恢复默认由 Goose 解析自己的默认 Provider。
Skills 沿既有来源和交付组投影至 `.goose/skills`，原生同时发现 `.agents/skills`、`.claude/skills` 与原生用户目录。
不另建 Skills 加载器；未完成的跨平台发现验证仍标 DocumentationOnly。

## MCP 与活动

MCP 保存只存配置，当前 Run 使用冻结快照；下一 Run 在共享获取入口判断 Host 兼容性。
Rovai 分配的原生 extension 名使用 `rovai_assigned_<server_id>`，在投影冻结和摘要生成前形成。
原生 load 只追加 MCP，故在 prompt 之前通过原生 extensions list/remove 删除已撤回的上述 owned 前缀项。
不删除用户原生扩展，不用 exclusive extensions 覆盖原生集合，不增设 dirty、队列或 MCP 管理器。
原生恢复可能先启动旧扩展，保证的是 P 发送前撤回完成，不承诺无启动动作。
不同 cwd 的本地 stdio MCP 复用 bundled `rovai __mcp-stdio-cwd`；远程 HTTP 不需要此路径。
不增加隐式 Node 运行依赖，不解析 Python/Node 参数来猜路径。

原生工具名来自 `_meta.goose.toolCall`，接入共享 command、file-operation 与子代理展示。
`write/edit` 缺少完整旧文件前像，完整 Diff 明确 Unsupported；不把替换片段当完整 Diff，不写入两份文件操作。
`shell` 输出沿共享永久 7.5 KiB 预算、snapshot 去重与现有截断提示。
`delegate` 的工具返回只表示委派调用完成，原生 parent prompt 仍等待前台子代理；不伪造 child 完成或 transcript。

## 用量与开放范围

声明原生 customNotifications，只消费官方 `usage_update/message_usage` 的数值白名单。
Session 累计 input/output 与原生估算费用使用派发前基线；逐消息只补 cache，避免重复计数。
费用缺失的 token 更新不能抹掉费用基线；cache 缺失保持 partial，不补零。
历史回放不归当前 Run；冷恢复无可靠基线时宁可缺首个差值，不计入历史。
不增加 SQLite reader、历史轮询或完整私有元数据日志。

macOS arm64 按 [D86](../versions/v1.72/decisions.md#v1-72-d86) 开放 Preview，其余平台 NotQualified。
受控 Provider 不等同真实账号、平台资格或全部模型；完整 Diff 和父 B 不传原生子代理是已接受的原生差异。
具体测试、真实官方二进制证据和未验证范围归本版实施记录，不从 Kilo 继承资格。
