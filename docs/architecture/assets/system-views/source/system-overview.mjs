// Figure 01: a component architecture overview, with colors assigned by responsibility.
export const P = {
  ink: '#26364b', muted: '#617086', border: '#cdd7e2',
  access: { main: '#527ca9', soft: '#f0f5fa', border: '#b7ccdf' },
  peer: { main: '#8064b4', soft: '#f4f0fa', border: '#cbbdde' },
  responsibility: { main: '#bb842e', soft: '#fcf5e7', border: '#dfc48e' },
  context: { main: '#3e9274', soft: '#eef7f2', border: '#afd2c1' },
  memory: { main: '#55966b', soft: '#f0f7ed', border: '#bdd4b0' },
  toolkit: { main: '#318f99', soft: '#edf7f8', border: '#abd0d4' },
  runtime: { main: '#497fc3', soft: '#edf4fd', border: '#adc6e7' },
  resource: { main: '#758397', soft: '#f3f5f8', border: '#c8d0db' },
};
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const label = (x, y, content, size = 18, opts = {}) => {
  const lines = Array.isArray(content) ? content : [content];
  return lines.map((line, i) => `<text x="${x}" y="${y + i * (opts.leading || 27)}" font-size="${size}" font-weight="${opts.weight || 400}" fill="${opts.color || P.ink}" text-anchor="${opts.anchor || 'start'}">${escape(line)}</text>`).join('');
};
export const rect = (x, y, w, h, fill, stroke, radius = 12, strokeWidth = 1.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
export function panel(x, y, w, h, title, tone, detail = '') {
  return rect(x, y, w, h, tone.soft, tone.border, 15)
    + `<path d="M${x + 21} ${y + 19} V${y + 42}" stroke="${tone.main}" stroke-width="5" stroke-linecap="round"/>`
    + label(x + 37, y + 36, title, 22, { weight: 600, color: tone.main })
    + (detail ? label(x + w - 22, y + 35, detail, 16, { anchor: 'end', color: P.muted }) : '');
}
export function tile(x, y, w, h, title, body, tone, size = 21) {
  return rect(x, y, w, h, '#ffffff', tone.border, 10)
    + label(x + 17, y + 29, title, size, { weight: 600, color: tone.main })
    + label(x + 17, y + 55, body, 16.5, { color: P.muted, leading: 25 });
}
function component(x, y, w, h, title, codes, lines, tone) {
  const codeLines = Array.isArray(codes) ? codes : [codes];
  return rect(x, y, w, h, '#ffffff', tone.border, 11)
    + rect(x, y, w, 44, tone.main, 'none', 10)
    + `<rect x="${x}" y="${y + 30}" width="${w}" height="14" fill="${tone.main}"/>`
    + label(x + 17, y + 29, title, 21, { weight: 600, color: '#fff' })
    + label(x + 17, y + 76, codeLines, 15, { weight: 600, color: tone.main, leading: 24 })
    + label(x + 17, y + 93 + codeLines.length * 24, lines, 17, { color: P.ink, leading: 29 });
}
export function connection(d, tone = P.resource, opts = {}) {
  return `<path d="${d}" fill="none" stroke="${tone.main}" stroke-width="${opts.width || 2}" stroke-linecap="round" stroke-linejoin="round" ${opts.dashed ? 'stroke-dasharray="6 7"' : ''} ${opts.arrow === false ? '' : `marker-end="url(#overview-arrow-${tone.main.slice(1)})"`} ${opts.both ? `marker-start="url(#overview-arrow-${tone.main.slice(1)})"` : ''}/>`;
}
function peer(x, y, name, isLead = false) {
  return rect(x, y, 280, 128, '#ffffff', isLead ? P.responsibility.main : P.peer.border, 11, isLead ? 2 : 1.5)
    + label(x + 18, y + 32, name, 23, { weight: 600, color: P.peer.main })
    + rect(x + 196, y + 12, 66, 27, isLead ? P.responsibility.soft : P.peer.soft, 'none', 6)
    + label(x + 229, y + 31, isLead ? '轻量 Lead' : 'Peer', isLead ? 13 : 15, { weight: 600, anchor: 'middle', color: isLead ? P.responsibility.main : P.peer.main })
    + label(x + 18, y + 65, isLead
      ? ['默认承接 · 协调责任与汇总', '独立 Conversation / AgentRun', '定向委托 · 按需组织 Gather']
      : ['独立 Conversation / AgentRun', '自身身份 · Runtime 配置', '按目标选择同伴与工具'], 17, { color: P.muted, leading: 25 });
}

export function renderSystemOverview() {
  const W = 1504, H = 1510;
  const tones = [P.access, P.peer, P.responsibility, P.context, P.memory, P.toolkit, P.runtime, P.resource];
  const defs = tones.map(t => `<marker id="overview-arrow-${t.main.slice(1)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 L8 5 L1 9" fill="none" stroke="${t.main}" stroke-width="1.7"/></marker>`).join('');

  const containers =
    panel(18, 14, 1468, 132, '01  用户与工作入口', P.access, '提供目标与约束 · 参与讨论与验收 · 按需介入')
    + panel(18, 208, 1468, 376, '02  长期队员与 Camp 协作空间', P.peer, 'Peer 协作 · 轻量 Lead · 持续身份')
    + panel(334, 262, 1128, 299, 'Camp · 本次协作空间', P.peer, '未指定收件人时由 Default Lead 承接')
    + panel(18, 644, 1468, 318, '03  Rovai Core · 核心领域与执行控制', P.resource, 'Rust · 协作事实与领域操作由 Core 承载')
    + panel(18, 1040, 1468, 202, '04  本机 Coding Agent Runtimes', P.runtime, '代表性产品与协议 · 按已接入能力适配')
    + panel(18, 1310, 1468, 150, '05  工作资源与外部能力', P.resource, '本地工作区与 Runtime 配置保持用户所有');

  const connections =
    connection('M752 146 V208', P.access, { both: true })
    + label(774, 181, '目标输入 / 结果与用户关注', 17, { color: P.access.main })
    + connection('M306 395 H334', P.peer)
    + connection('M644 389 H762', P.peer, { both: true })
    + label(703, 372, 'A2A', 17, { anchor: 'middle', color: P.peer.main, weight: 600 })
    + connection('M1042 389 H1164', P.peer, { both: true })
    + label(1103, 372, 'A2A', 17, { anchor: 'middle', color: P.peer.main, weight: 600 })
    + connection('M500 449 C647 497 1159 497 1304 449', P.peer, { both: true })
    + label(902, 501, '成员之间直接委托、咨询与反馈', 17, { anchor: 'middle', color: P.peer.main })
    + connection('M900 584 V644', P.peer, { both: true })
    + label(922, 620, '显式平台操作 / 协作事实与执行状态', 17, { color: P.peer.main })
    + connection('M632 931 V1040', P.context, { dashed: true })
    + label(610, 1009, 'Bootstrap + 每次 Run 的动态输入', 17, { color: P.context.main, anchor: 'end' })
    + connection('M1112 1040 V931', P.toolkit)
    + label(1090, 1009, 'CLI 平台工具调用', 17, { color: P.toolkit.main, anchor: 'end' })
    + connection('M1352 931 V1040', P.runtime, { both: true })
    + label(1330, 984, 'Fleet / Adapter', 17, { color: P.runtime.main, anchor: 'end', weight: 600 })
    + label(1330, 1009, '启动 · 输入 · 原生事件', 17, { color: P.runtime.main, anchor: 'end' })
    + connection('M264 1242 V1310', P.resource, { both: true })
    + label(286, 1283, '读写文件与成果', 17, { color: P.resource.main })
    + connection('M752 1242 V1310', P.runtime, { both: true })
    + label(774, 1283, '模型请求与响应', 17, { color: P.runtime.main })
    + connection('M1240 1242 V1310', P.toolkit, { both: true })
    + label(1262, 1283, '外部工具调用', 17, { color: P.toolkit.main });

  const entries =
    tile(42, 67, 456, 61, '桌面工作台', 'React / Electron · Camp、单聊与执行查看', P.access)
    + tile(524, 67, 456, 61, '飞书 / 钉钉渠道', '渠道消息与队员 Bot · 绑定 Camp 协作', P.access)
    + tile(1006, 67, 456, 61, '本机自动化入口', '用户 CLI / 定时 Automation · 触发已授权工作', P.access);

  const team =
    rect(42, 262, 264, 299, '#ffffff', P.peer.border, 11)
    + label(60, 300, 'AgentProfile', 24, { weight: 600, color: P.peer.main })
    + label(60, 329, '应用级长期队员 · 稳定 Agent ID', 16, { color: P.muted })
    + `<path d="M60 349 H288" stroke="${P.peer.border}"/>`
    + label(60, 379, ['名称 · 团队角色 · 专业职责', '性格底色 · 工作准则', '成长课题 · 自身身份投影'], 17, { leading: 31 })
    + rect(59, 477, 230, 61, P.peer.soft, 'none', 7)
    + label(75, 502, 'CampMember', 18, { weight: 600, color: P.peer.main })
    + label(75, 525, '同一队员，跨 Camp 参与', 15.5, { color: P.muted })
    + peer(364, 321, '队员 A')
    + peer(762, 321, 'Default Lead', true)
    + peer(1164, 321, '队员 B')
    + rect(358, 519, 262, 27, P.peer.soft, P.peer.border, 6)
    + label(489, 538, '公共讨论 · CampMessage', 16, { anchor: 'middle', color: P.peer.main })
    + rect(634, 519, 250, 27, P.responsibility.soft, P.responsibility.border, 6)
    + label(759, 538, '可选长期责任 · Task', 16, { anchor: 'middle', color: P.responsibility.main })
    + rect(898, 519, 250, 27, P.resource.soft, P.resource.border, 6)
    + label(1023, 538, '共享成果 · 附件 / 文件引用', 16, { anchor: 'middle', color: P.resource.main })
    + rect(1162, 519, 276, 27, P.context.soft, P.context.border, 6)
    + label(1300, 538, '成员名册 · 获授权的公共历史', 16, { anchor: 'middle', color: P.context.main });

  const core =
    component(42, 708, 220, 223, 'A2A 消息与路由', 'CampMessage · Delivery', ['显式收件人 · 独立投递', 'Caller Return · 调用来路', '目标队列 · 协作预算'], P.peer)
    + component(282, 708, 220, 223, '协作组织与责任', 'Task · Gather · CampTurn', ['目标 · 负责人 · 验收', '并行征集 · 一次汇总', '责任关联 · 多 Run 延续'], P.responsibility)
    + component(522, 708, 220, 223, '动态上下文', 'Bootstrap · Profile', ['自身身份 · 同伴名片', '公共历史 · 完整当前输入', '可见范围 · 输入预算', 'ContextManifest · 冻结'], P.context)
    + component(762, 708, 220, 223, '长期记忆', ['Hearth · Companion', 'Relationship'], ['用户审核 · 正式晋升', '修订 · 替代 · 退役 · 遗忘', '按 Scope 授权读取'], P.memory)
    + component(1002, 708, 220, 223, 'CLI + Skill Toolkit', 'Skill · CLI · Router', ['Skill 按需提供协作方法', 'rovai CLI 表达平台动作', '认证 IPC · Run 身份', '结构化结果 · 原生投影'], P.toolkit)
    + component(1242, 708, 220, 223, 'AgentRun 执行', 'AgentRun · Runtime Fleet', ['队列准入 · 执行配置', 'Runtime Adapter · 协议', '模型 / 权限 · 按能力接入', '原生事件 · 过程与结果'], P.runtime);

  const runtimes =
    tile(42, 1099, 335, 88, 'Codex', ['app-server', '原生 Session · 模型循环 · 工具执行'], P.runtime)
    + tile(404, 1099, 335, 88, 'Claude Code', ['stream-json', '原生 Session · 模型循环 · 工具执行'], P.runtime)
    + tile(766, 1099, 335, 88, 'ACP 类 Runtime', ['ACP', '原生 Session · 模型循环 · 工具执行'], P.runtime)
    + tile(1128, 1099, 334, 88, 'Pi', ['JSONL RPC', '原生 Session · 模型循环 · 工具执行'], P.runtime)
    + label(752, 1220, '同一队员通过配置连接 Runtime；身份与记忆持续存在，原生执行能力由所选 Runtime 提供。', 18, { anchor: 'middle', color: P.runtime.main });

  const resources =
    tile(42, 1367, 456, 72, '项目工作目录与协作成果', '本地文件 / Git · 原生工具读写 · 受管附件交付', P.resource)
    + tile(524, 1367, 456, 72, '模型服务与原生配置', '所选 Runtime 的模型、Provider 与授权配置', P.runtime)
    + tile(1006, 1367, 456, 72, '外部 MCP 与工具服务', '按 Runtime 能力投影 · 扩展外部信息与操作', P.toolkit);

  const legends = [
    ['队员与协作', P.peer], ['任务责任', P.responsibility], ['上下文与记忆', P.context],
    ['平台 Toolkit', P.toolkit], ['Runtime 执行', P.runtime], ['资源与依赖', P.resource],
  ].map(([name, tone], i) => rect(122 + i * 223, 1484, 12, 12, tone.main, 'none', 3)
    + label(143 + i * 223, 1496, name, 16, { color: P.muted })).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs><g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">${containers}${connections}${entries}${team}${core}${runtimes}${resources}${legends}</g></svg>`;
}
