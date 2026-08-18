---
document_type: version-architecture
version: v0.37
authority: implementation-design
status: frozen
last_updated: 2026-08-04
---

# v0.37 MCP 架构与协议

## 1. Canonical file

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  },
  "_rovai": {
    "schemaVersion": 2,
    "servers": {
      "context7": {
        "serverId": "opaque-uuid",
        "enabled": false,
        "source": "builtin",
        "presetId": "context7",
        "riskLevel": "standard",
        "riskAcknowledged": false
      }
    },
    "assignments": [
      {
        "serverId": "opaque-uuid",
        "agentProfileId": "agent-id"
      }
    ]
  }
}
```

`mcpServers` 与 `_rovai.servers` 的 key 集合必须完全一致。Assignment 只引用 `serverId`；
Server Name 变更时 Core 原子移动两处 key 并保留 ID。删除后同名重建产生新 ID。

Core 使用 duplicate-key rejecting parser，随后执行字段闭集、名称 case-fold 唯一、ID 唯一、
metadata parity、Assignment 唯一和引用完整性校验。未知 AgentProfile Assignment 可以只读保留
为 inert data；一次成功 App mutation 会清理它。其他无效状态使整份文件 fail closed，原始字节
保持不变。

## 2. Public JSON editor

Create/Update RPC 接收一个只含 `mcpServers` 的 JSON 文本，并要求恰好一个条目。Core 自己
解析、校验和规范化，Renderer 不提交拆分 transport fields。Update 通过 `serverId` 找到当前
对象，因而 rename 不依赖旧 Name 作为 authority key。

Core 返回给 Renderer 的 `definitionJson` 和顶部 `publicConfigJson` 会把 literal sensitive
`env`/`headers` 值替换为只对当前 Server path 与 `expectedConfigDigest` 有效的 preservation
marker。marker 只能原位保留已有值，不能用于新字段或新 Server，且绝不序列化进 canonical
file 或 projection。

## 3. Reviewed defaults

只有文件不存在时才原子创建：

- `context7`：`https://mcp.context7.com/mcp`，API Key header 可由用户后续加入；
- `playwright`：`npx -y @playwright/mcp@0.0.78 --isolated`，high risk。

GitHub 暂不作为 reviewed default。

二者 metadata 初始 `enabled=false`、无 Assignment。文件一旦存在，加载与升级都不补写、
恢复或覆盖 reviewed defaults。

## 4. Import boundary

Importer 只读取已知 user-level source，永不写回。source `enabled` 不继承，目标总是 disabled
且 unassigned。

- 允许：`type/transport` 等纯结构差异、command array、已知 env-header representation；
- 明确列出后丢弃：不会改变权限的已知 timeout/startup 等运行参数；
- 阻止：tool allow/deny、autoApprove/alwaysAllow、trust、OAuth、credential cache、Runtime
  sandbox/approval policy、unknown field 和无法识别 transport。

所有 literal sensitive source value 都只形成“需要重新绑定”的字段说明，不进入 inspection
JSON、日志或 normalized candidate。用户可以查看预览后手动创建标准 JSON，但产品不声明
等价迁移。

## 5. Assignment and enablement

设置页每次勾选或取消立即提交 `serverId + agentProfileId + assigned + expectedDigest`。Core
使用全文件 CAS 与原子替换；冲突或失败时 Renderer 回滚 optimistic state、重新读取并显示可恢复
错误。关闭 picker 没有另一个提交或取消语义。

Enabled 与 Assignment 独立。High-risk Server 第一次由任一操作达到 enabled+assigned 时，
Core 要求显式 acknowledgement 并在 metadata 中保存。之后普通启停/Assignment 使用同一
原子路径。

## 6. Projection and runtime precedence

AgentRun creation 读取 canonical file 一次，解析 enabled+assigned definitions，解析严格
`${NAME}` interpolation，并冻结 MCP Projection Input。单 Server 缺 env/cwd 或 transport
不受支持只排除该 Server；全文件无效或 Adapter external projection unsupported 产生空外部
集合。二者都不阻止基础 AgentRun，Team Gateway 独立准备。

八种 Adapter 的同名规则固定为：

```text
Rovai projected name wins same-named Runtime native MCP
non-conflicting native MCP follows the Adapter's existing isolation policy
```

Exact private-config Adapter 使用完整替换或 strict config。Claude Code 的 MCP 最低版本为
`1.0.44`（首个包含 `--strict-mcp-config` 的发布版本）；Copilot 的 MCP 最低版本为
`0.0.370`（追加配置已可用且同版本修复了 `--disable-mcp-server`）。只设最低版本，
不设上限；未知或更高版本继续尝试既有机制。Copilot 先只读发现 native names，
排除/禁用 native entry，再以不会被同一 disable selector 命中的 private runtime alias 注入 Rovai
definition；canonical-to-runtime mapping 冻结并进入 Exposure evidence。Adapter 无法可靠证明该
语义时 external projection 标为 unsupported，而不是伪造 success。

仅当 Runtime 明确以 MCP config/flag rejection 拒绝启动时，允许同一 Projection Input 进行一次
无用户 external MCP 的 retry。非 MCP 错误不 retry。Runtime Session 成功后 seal 最终 Exposure；
recovery 复用该 private projection，不读取 live file。

## 7. Runtime-group Skill delivery

Skill 使用独立于 MCP Assignment 的应用级 Library。一个全局唯一 `Skill.name` 指向当前不可变
Revision；启停只暂停投递，不删除九个固定 Delivery Group 的 Assignment。官方与导入 Skill
均默认启用、未分组，更新导入内容只发布新 Revision。

Core 按 Runtime 声明的项目原生目录投影受管 symlink：Codex、OpenCode、Copilot、Claude
compatible、Antigravity、Kiro、Qoder、CodeBuddy、Qwen。它不读取或接管 `.agents/skills`，不覆盖
普通文件、目录或非 Rovai link；同名目标记录为 `shadowed`。活跃 AgentRun 使用中的投影不原地
切换，新 Run 冻结实际可见 Revision 与路径。完整 identity、重叠 discovery 和删除语义以
[ADR-0105](decisions.md#adr-0105) 为准。
