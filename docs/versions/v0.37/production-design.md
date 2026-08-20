---
document_type: production-design
version: v0.37
authority: renderer-ui-contract
status: frozen
last_updated: 2026-08-04
---

# v0.37 MCP 设置页生产设计

## Reference boundary

`<local-input>/rovai_mcp_settings_prototype_v4.html` 是本页面内容结构、成员
picker、Server tofu、Add/Edit Dialog、Import Preview 与风险确认的定向输入。生产实现保留
现有 Arctic Dawn 设置侧栏、Token、Radix Dialog、按钮、字体、状态与中文产品词汇；不复制
原型全局侧栏、演示数据、演示状态切换器、浮动 `@latest` 或不安全配置。

## Page order

1. Hero：标题 MCP、说明、“从本机 Agent 导入”和“添加 MCP”。
2. Config disclosure：默认收起，显示 `~/.rovai/mcp.json`、状态和 Finder 入口；展开只读
   `mcpServers` public preview，隐藏 `_rovai` 并遮罩 literal sensitive values。
3. “为队员配置 MCP”：只展示 `present` 队员的 tofu tile；tile 内 multi-select picker 列出全部
   Server，包括 disabled reviewed defaults。每次 checkbox 立即持久化，并显示局部 saving。
4. “已安装 MCP”：搜索 + Server tofu grid。每卡显示 Name、transport、来源、endpoint、启停、
   Assignment 数量和可访问成员名单、Edit/Delete。这里不提供第二套 Assignment editor。

页面不在队员管理增加 MCP Tab。

## Add and edit

Dialog 只包含 JSON editor、Format、Schema help、Cancel、Save。JSON 根只能有
`mcpServers` 且恰好一个 entry；对象 key 是 Name，没有 `serverName`。Create 默认 disabled、
unassigned；Update 保留 serverId、enablement、Assignments 和 provenance。保存失败保留正文、
滚动与焦点。

## Import

点击按钮后才扫描。Dialog 按 source candidate 展示：来源与路径、masked source preview、
normalized standard JSON、无损转换、将丢弃字段、阻止原因和需重新绑定的 sensitive key。
Blocking candidate 不能选择；importable candidate 可改目标 Name。提交结果统一 disabled、
unassigned。没有后台初次 auto scan。

## State and accessibility

- Loading：保持三段结构的 skeleton，不显示虚构数量。
- No present members：Assignment section 解释需要先添加/归队队员；Server 管理仍可用。
- Invalid file：保留 hero/disclosure，禁用 mutations，提供重新读取和打开文件。
- Permission issue：提供修复权限，不把它伪装成连接错误。
- Assignment conflict/failure：回滚 checkbox、重新读取、在 tile 邻近显示恢复信息。
- Playwright high risk：第一次达到 enabled+assigned 时使用 Radix confirmation；取消恢复原状态。
- 1440×920 使用最多五列 member tofu、三/四列 Server tofu；1040×700 收敛列数，不出现整页
  横向滚动。Picker、Dialog、Disclosure、Switch、search 和 tooltips 全部可键盘访问并支持
  reduced motion。
