// Architecture views verified against the local package manifests, CoreClient and built-in tool seams.
import { readFileSync } from 'node:fs';
import { P, label, rect, connection } from './system-overview.mjs';
import { frame } from './collaboration-comics.mjs';

function area(x, y, w, h, title, tone, aside = '') {
  return rect(x, y, w, h, tone.soft, tone.border, 16)
    + label(x + 27, y + 43, title, 27, { color: tone.main, weight: 600 })
    + (aside ? label(x + w - 27, y + 42, aside, 17, { color: P.muted, anchor: 'end' }) : '');
}

function card(x, y, w, h, title, body, tone, size = 23) {
  return rect(x, y, w, h, '#fff', tone.border, 10)
    + label(x + 20, y + 35, title, size, { color: tone.main, weight: 600 })
    + (body ? label(x + 20, y + 69, body, 18, { color: P.muted, leading: 29 }) : '');
}

function chip(x, y, w, title, tone, size = 18) {
  return rect(x, y, w, 36, '#fff', tone.border, 8)
    + label(x + w / 2, y + 25, title, size, { color: tone.main, anchor: 'middle', weight: 600 });
}

function logo(filename, x, y, size = 44) {
  const svg = readFileSync(new URL(`../../../../../apps/desktop/src/renderer/src/assets/runtime-logos/${filename}`, import.meta.url)).toString('base64');
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${svg}"/>`;
}

export function renderToolkitArchitecture() {
  const runtime =
    area(18, 14, 1468, 208, '原生 Agent Runtime', P.runtime, 'Session · 模型循环 · 原生工具')
    + card(49, 91, 343, 100, 'Native Skill Discovery', '按需发现并读取方法', P.runtime, 22)
    + rect(492, 91, 521, 100, '#fff', P.runtime.border, 10)
    + label(514, 128, 'Agent / Native Session', 24, { color: P.runtime.main, weight: 600 })
    + logo('codex-color.svg', 518, 145, 29)
    + label(558, 168, 'Codex', 19, { color: P.ink })
    + logo('claudecode-color.svg', 682, 145, 29)
    + label(722, 168, 'Claude Code · …', 19, { color: P.ink })
    + card(1113, 91, 342, 100, '原生工具调用', '在当前 Run 中执行 CLI', P.runtime, 23)
    + connection('M398 142 H485', P.runtime, { width: 2.3 })
    + connection('M1018 142 H1106', P.runtime, { width: 2.3 });

  const toolkit =
    area(18, 295, 704, 259, 'Skill Library · 协作方法', P.peer)
    + card(46, 371, 310, 72, 'campfire / review-duo', '', P.peer, 20)
    + card(380, 371, 314, 72, 'grill-duo', '', P.peer, 20)
    + card(46, 460, 310, 66, 'cli-operations', '', P.peer, 20)
    + card(380, 460, 314, 66, 'memory-stewardship', '', P.peer, 20)
    + area(764, 295, 722, 259, 'Rovai CLI · 平台动作', P.toolkit, '固定命令 · 精确 --help')
    + ['send', 'gather', 'task', 'camp / history', 'memory', 'member', 'automation', 'single-chat'].map((name, i) =>
      chip(792 + i % 4 * 169, 376 + Math.floor(i / 4) * 78, 155, name, P.toolkit, name.length > 12 ? 16 : 18)).join('')
    + connection('M221 290 V228', P.peer, { width: 2.3 })
    + label(250, 267, 'Skill Projection', 18, { color: P.peer.main })
    + connection('M1284 227 V289', P.toolkit, { width: 2.3 })
    + label(1258, 267, '命令参数', 18, { color: P.toolkit.main, anchor: 'end' });

  const transport =
    connection('M1126 559 V594', P.toolkit, { width: 2.3, both: true })
    + rect(429, 603, 1026, 72, P.toolkit.soft, P.toolkit.border, 12)
    + label(455, 647, 'Authenticated Local IPC', 25, { color: P.toolkit.main, weight: 600 })
    + label(1427, 647, 'Unix Socket / Windows Named Pipe', 21, { color: P.toolkit.main, anchor: 'end' })
    + connection('M942 681 V727', P.toolkit, { width: 2.3, both: true })
    + label(914, 714, '调用 / 返回', 17, { color: P.muted, anchor: 'end' });

  const core =
    area(18, 734, 1468, 367, 'Rovai Core', P.context, '按会话模式与操作资格开放能力')
    + rect(47, 807, 1410, 71, '#fff', P.context.border, 10)
    + label(69, 852, 'BuiltinToolRouter', 25, { color: P.context.main, weight: 600 })
    + label(1429, 852, 'Run · Lease · Native Binding → 领域服务', 22, { color: P.context.main, anchor: 'end' })
    + [
      ['消息与协作', 'A2A · Task · Gather'],
      ['历史检索', 'Camp · Single Chat'],
      ['Memory', 'View · Search · Write'],
      ['队员资料', 'Member Profile'],
      ['定时任务', 'Automation'],
    ].map(([title, body], i) => card(47 + i * 286, 907, 265, 96, title, body, P.context, 23)).join('')
    + rect(47, 1030, 1410, 45, P.toolkit.soft, P.toolkit.border, 9)
    + label(752, 1060, '领域结果 → Agent Result Projection → JSON stdout', 21, { color: P.toolkit.main, anchor: 'middle', weight: 600 });

  return frame(1126, runtime + toolkit + transport + core);
}

export function renderTechnologyStack() {
  const renderer =
    area(18, 14, 1120, 217, 'Renderer · 桌面工作台', P.peer)
    + card(45, 92, 246, 109, 'React · TypeScript', '组件与应用状态', P.peer, 21)
    + card(316, 92, 246, 109, 'Lexical', '编辑器 · 结构化提及', P.peer, 24)
    + card(587, 92, 246, 109, 'CodeMirror', '文件与代码预览', P.peer, 24)
    + card(858, 92, 252, 109, 'Radix · Markdown', '交互组件 · 内容呈现', P.peer, 20)
    + connection('M578 237 V296', P.peer, { width: 2.3, both: true })
    + label(602, 275, 'Electron IPC · Preload Bridge', 20, { color: P.peer.main });

  const main =
    area(18, 303, 1120, 218, 'Electron Main · Node.js / TypeScript', P.access)
    + card(45, 382, 337, 109, 'CoreClient', '子进程管理 · 请求与事件', P.access, 24)
    + card(409, 382, 337, 109, '本机能力', '文件预览 · 系统集成', P.access, 24)
    + card(773, 382, 337, 109, 'Channel Host', ['飞书 Node SDK', 'DingTalk Stream'], P.access, 24)
    + connection('M578 527 V587', P.access, { width: 2.3, both: true })
    + label(602, 566, 'NDJSON / stdio', 20, { color: P.access.main });

  const core =
    area(18, 594, 1120, 249, 'rovai-core · Rust / Tokio', P.context)
    + card(45, 674, 337, 136, '领域服务', ['Serde · Typed Commands', 'Domain Command Gateway'], P.context, 24)
    + card(409, 674, 337, 136, '异步执行', ['Tokio · Scheduler', 'Runtime Fleet'], P.context, 24)
    + card(773, 674, 337, 136, '输入与本地服务', ['Context · Memory', 'Local IPC · BuiltinToolRouter'], P.context, 23)
    + connection('M358 849 V908', P.runtime, { width: 2.3, both: true })
    + label(387, 888, 'Adapter / 原生协议', 20, { color: P.runtime.main })
    + connection('M954 849 V908', P.resource, { width: 2.3, both: true })
    + label(929, 888, 'rusqlite / 文件 I/O', 20, { color: P.resource.main, anchor: 'end' });

  const execution =
    area(18, 915, 716, 273, 'Native Agent Runtime', P.runtime)
    + rect(45, 990, 315, 110, '#fff', P.runtime.border, 10)
    + logo('codex-color.svg', 62, 1009, 40)
    + label(116, 1038, 'Codex', 24, { color: P.runtime.main, weight: 600 })
    + label(65, 1073, 'app-server · JSON-RPC', 19, { color: P.muted })
    + rect(388, 990, 318, 110, '#fff', P.runtime.border, 10)
    + logo('claudecode-color.svg', 405, 1009, 40)
    + label(459, 1038, 'Claude Code', 24, { color: P.runtime.main, weight: 600 })
    + label(408, 1073, 'stream-json', 19, { color: P.muted })
    + chip(45, 1123, 661, 'ACP · OpenCode / Copilot / Kimi / …', P.runtime, 20)
    + area(766, 915, 372, 273, '本地存储', P.resource)
    + card(791, 990, 322, 79, 'SQLite · FTS5', '', P.resource, 25)
    + label(812, 1050, '领域数据 · 搜索索引', 18, { color: P.muted })
    + card(791, 1089, 322, 74, 'Managed Files', '', P.resource, 24)
    + label(812, 1148, '附件 · Blob · 执行资源', 18, { color: P.muted })
    + connection('M378 1194 V1235', P.runtime, { width: 2.3, both: true })
    + area(18, 1242, 1120, 91, '原生执行与外部扩展', P.runtime)
    + label(1105, 1295, '模型服务 · 原生工具 · 项目目录 · MCP', 22, { color: P.runtime.main, anchor: 'end' });

  const engineering =
    area(1172, 14, 314, 1319, '工程与交付', P.responsibility)
    + card(1196, 110, 266, 145, '构建', ['pnpm · Vite', 'electron-vite'], P.responsibility, 26)
    + card(1196, 294, 266, 168, '验证', ['Vitest · node:test', 'cargo test', '文档与契约门禁'], P.responsibility, 26)
    + card(1196, 504, 266, 165, '打包', ['Cargo · Sidecar', 'electron-builder', '安装包与更新'], P.responsibility, 26)
    + card(1196, 711, 266, 142, '运行平台', ['macOS', 'Windows'], P.responsibility, 26)
    + rect(1208, 923, 242, 311, '#fff', P.responsibility.border, 13)
    + label(1329, 968, '本地优先', 27, { color: P.responsibility.main, anchor: 'middle', weight: 600 })
    + label(1329, 1013, ['桌面交互', 'Rust 协作内核', '独立原生 Runtime', '本机数据与工作目录'], 21, { color: P.responsibility.main, anchor: 'middle', leading: 52 });

  return frame(1361, renderer + main + core + execution + engineering);
}
