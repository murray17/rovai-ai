---
document_type: protocol-contract
contract: feishu-channel-v10
authority: feishu-channel-execution-card-and-lan-readonly-view
status: accepted
version: 10
last_updated: 2026-09-01
---

# Feishu Channel v10 Contract

继承 [Feishu Channel v9](feishu-channel-v9.md) 的执行卡、固定 `open_url`、全局 LAN HTTP 服务、内存 Token、
授权 scope、Owner callback、生命周期和持久兼容边界。本版只收敛 Web 执行台的公开投影与嵌套 disclosure；
飞书卡片、Core 授权和钉钉行为不变。

## 1. 公开执行投影

Main 继续只从 Core scope 读取结果生成 boot-scoped 快照。Run 的公开 `items` 只包含正文和连续操作组：

```text
narration {
  body
}

activityGroup {
  status
  statusLabel
  primary
  currentTitle?
  accessibleLabel
  activities[] {
    iconKind
    title
    status
    statusLabel
    result?
    files[] { path, additions?, deletions? }
  }
}
```

连续 Tool 归组、组状态、公开标题、状态映射、结果投影和脱敏必须复用生产执行台的共享 presentation helper，
不得在 Web 页面另建一套 tool 解释器。触发消息在这个公开阅读面固定把作者投影为“你”，不返回“飞书成员”或
飞书渠道标签。原始外部作者字段不因此改写 Core 数据。

`schemaVersion` 仍为 `1`：页面和 Main 服务随同一个 Desktop build 原子更新，Token 只存在 Main 内存；Main 重启后
旧 Token 全部失效，因此不存在旧页面跨重启读取新 shape 的兼容窗口。

## 2. 嵌套 disclosure

页面按同一 Camp、同一队员的时间顺序连续展示 Run，保持以下三层独立 disclosure：

1. 每个 AgentRun 都有自己的过程 disclosure；`focusRunId` 默认展开，历史 Run 默认收起；
2. 每个连续操作组都有自己的 disclosure；当前 Run 的尾部操作组默认展开，其余默认收起；
3. 每个没有文件变化投影的 Command 都必须渲染为可独立展开的 disclosure，不因 `result` 为空而改成静态行；
   当前默认展开组的第一条 Command 默认展开，其余默认收起。

Command 展开后，有安全公开结果就显示结果；运行中且暂无结果显示“正在执行”，其他无结果状态显示“暂无公开结果”。
含文件变化的 activity 延续生产执行台语义，逐文件显示独立 disclosure，不同时重复一条 Command 行。Run、操作组、
Command 和文件的开合状态只存在页面内存，SSE snapshot 重绘时按稳定 key 保留，刷新页面后恢复上述默认值。

点击 Run 标题只切换页面顶部的触发消息，不代替该 Run 的过程 disclosure。页面不提供分页、写操作、继续对话、
停止或审批入口。

## 3. 视觉与响应式

Web 页面复用当前 Rovai Porcelain Day / Steel Night 的语义 token、品牌标记、消息身份色、Evidence 层级和生产执行台
的操作组密度，不增加“局域网视图”等解释标签。桌面和手机使用同一阅读顺序；手机所有 Run、操作组、Command 与
文件 summary 的触控高度至少 44 CSS px，长命令、结果和路径不得制造页面级横向滚动。

所有 disclosure 必须可由键盘 Enter/Space 激活并具有可见焦点；状态同时有文字或可访问名称，不只依赖颜色。
页面尊重 `prefers-reduced-motion`，系统日夜主题切换不得改变授权、内容或折叠语义。

## References

- [Feishu Channel v9](feishu-channel-v9.md)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道 UI](../ui/components/channel-settings.md)
- [v1.37 实施计划](../versions/v1.37/implementation-plan.md)
- [V1.37-D04](../versions/v1.37/decisions.md#v1-37-d04)
