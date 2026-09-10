// Confirmed from static production calls at revision 23c00258; native execution was not_run.
// main.rs: dispatch_agent_run_candidate → claim_agent_run → launch_agent_run;
// message_delivery.rs: dispatch_pending_for_recipient orders by queue_sequence;
// runtime.rs: list_dispatchable_agent_runs preserves per-Conversation serial execution.
// prepare_agent_run_skill_exposure / prepare_agent_run_mcp_projection → Codex Fleet and binding;
// prepare_session_bootstrap → start_or_resume_agent_thread → materialize_agent_run_context;
// prepare_input_delivery_for_context → begin_agent_run_input_dispatch → native turn / terminal events.
// runtime_fleet.rs: compatible IdleWarm acquire and quiescent Resident release;
// codex.rs: complete_agent_run detaches the Run and releases its Host as Reusable.
// Uses the Codex path as an explicit example; other Adapters have their own delivery protocols.
import { P, label, rect, connection } from './system-overview.mjs';
import { T, sketch, box, frame, avatar, pill } from './collaboration-comics.mjs';

function phase(s, y, h, n, title, tone, body, rightTitle, rightBody = []) {
  return box(s, 103, y, 1383, h, tone.soft, tone.border, false, 15)
    + s.circle(51, y + 39, 23, tone.main, '#fff')
    + label(51, y + 47, n, 22, { color: tone.main, weight: 600, anchor: 'middle' })
    + label(133, y + 41, title, 25, { color: tone.main, weight: 600 })
    + label(134, y + 89, body, 20, { color: P.ink, leading: 35 })
    + `<path d="M784 ${y + 24} V${y + h - 24}" stroke="${tone.border}" stroke-width="1.4"/>`
    + label(814, y + 41, rightTitle, 23, { color: tone.main, weight: 600 })
    + label(815, y + 89, rightBody, 20, { color: P.ink, leading: 35 });
}

export function renderRunLifecycle() {
  const s = sketch();
  const headings = label(134, 39, 'Rovai Core · 加载与调度', 25, { color: P.ink, weight: 600 })
    + label(815, 39, '输入与原生执行 · Codex 示例', 25, { color: P.runtime.main, weight: 600 })
    + connection('M51 116 V1665', P.resource, { width: 2.1 });

  const admission = phase(s, 73, 278, '1', '接收工作，进入队列', T.ding,
    ['@咕咕 → Message Delivery'],
    '本次目标', ['验证 CSV 导出的空数据场景', '收件消息 · 来源引用 · 附件'])
    + avatar(s, 'gugu', 1402, 151, 40)
    + label(135, 202, '收件人队列 · FIFO', 20, { color: T.ding.main, weight: 600 })
    + box(s, 134, 219, 315, 73, '#fff', T.ding.border, false, 10)
    + [3, 2, 1].map((n, i) => pill(150 + i * 99, 238, 85, `请求 ${n}`, i === 2 ? T.teal : T.ding, 18)).join('')
    + connection('M456 256 H492', T.ding, { width: 2.2 })
    + box(s, 502, 219, 244, 73, '#fff', T.ding.border, false, 10)
    + label(624, 247, 'Dispatch Pump', 21, { color: T.ding.main, weight: 600, anchor: 'middle' })
    + label(624, 277, '物化 queued AgentRun', 17, { color: P.ink, anchor: 'middle' })
    + label(135, 326, '队首满足执行资格后推进', 18, { color: T.ding.main })
    + pill(815, 256, 352, '同一 Conversation 按序接续', T.ding, 20);

  const capability = phase(s, 373, 168, '2', '领取 Run，准备运行能力', T.ding,
    ['Scheduler 领取 · 读取冻结配置与工作目录', '校验 Skill 投影 · 准备 MCP Projection'],
    '本轮可用能力', ['SkillExposureSnapshot', '可发现的 Skills · 已配置的 MCP Servers']);

  const session = phase(s, 563, 295, '3', '取得 Host，绑定本轮执行', T.gugu,
    ['Runtime Fleet.acquire · 匹配兼容范围与配置'],
    'Native Session · 创建或接续', ['Adapter 连接 Host · 建立 Native Binding', 'Session Bootstrap 按会话时机提供'])
    + box(s, 134, 679, 255, 82, '#fff', P.runtime.border, false, 10)
    + label(261, 711, 'Warm Host', 25, { color: P.runtime.main, weight: 600, anchor: 'middle' })
    + label(261, 740, 'IdleWarm · 空闲常驻进程', 17, { color: P.runtime.main, anchor: 'middle' })
    + box(s, 429, 679, 315, 82, '#fff', T.ding.border, false, 10)
    + label(586, 711, '冷启动 Host', 23, { color: T.ding.main, weight: 600, anchor: 'middle' })
    + label(586, 740, '没有兼容的空闲 Host 时', 17, { color: T.ding.main, anchor: 'middle' })
    + connection('M261 769 V778 Q261 787 273 787 H427 Q439 787 439 797', P.runtime, { width: 2 })
    + connection('M586 769 V778 Q586 787 574 787 H451 Q439 787 439 797', P.runtime, { width: 2 })
    + pill(180, 804, 520, 'Active Lease → 当前 AgentRun / epoch', P.runtime, 18)
    + pill(814, 709, 175, 'Session Charter', T.gugu, 17)
    + pill(1002, 709, 208, 'MEMBER_IDENTITY', T.gugu, 17)
    + pill(1223, 709, 235, 'Memory Entrypoint', T.gugu, 17)
    + box(s, 814, 771, 644, 65, '#fff', T.gugu.border, false, 10)
    + label(836, 811, '轮换 Lease · Rovai CLI 绑定本轮身份', 20, { color: T.gugu.main });

  const context = phase(s, 880, 209, '4', '物化输入，交给本轮执行', T.green,
    ['Context Profile → Model Context Projection', 'ContextManifest → Runtime Input Delivery'],
    '送入本轮的模型上下文')
    + [
      ['同伴 · 自身责任 · 公共历史', T.gugu],
      ['运行事实 · 协作指引', T.teal],
      ['完整 CURRENT_INPUT', T.cheese],
    ].map(([name, tone], i) => rect(814, 942 + i * 43, 644, 34, '#fff', tone.border, 8)
      + label(834, 966 + i * 43, name, 18, { color: tone.main, weight: 600 })).join('');

  const running = phase(s, 1111, 292, '5', '执行中，按需获取信息和动作', T.teal,
    ['原生工具执行 Rovai CLI → Core 领域服务'],
    'Codex 原生模型循环')
    + pill(135, 1222, 180, 'A2A / Task', T.teal, 20)
    + pill(333, 1222, 180, 'History', T.teal, 20)
    + pill(531, 1222, 180, 'Memory', T.teal, 20)
    + label(134, 1306, ['按需读取 Skill，选择协作方法', '显式发送可在本轮发起同伴的新工作'], 20, { color: P.ink, leading: 35 })
    + box(s, 842, 1188, 230, 64, '#fff', P.runtime.border, false, 12)
    + label(957, 1230, '模型推理', 24, { color: P.runtime.main, weight: 600, anchor: 'middle' })
    + box(s, 1211, 1188, 230, 64, '#fff', P.runtime.border, false, 12)
    + label(1326, 1230, '原生工具', 24, { color: P.runtime.main, weight: 600, anchor: 'middle' })
    + connection('M1084 1209 H1197', P.runtime, { width: 2.3 })
    + connection('M1197 1236 H1084', P.runtime, { width: 2.3 })
    + label(1142, 1306, 'Skill · 文件 · CLI · 外部 MCP', 21, { color: P.runtime.main, anchor: 'middle' })
    + rect(813, 1337, 645, 43, '#fff', T.teal.border, 8)
    + label(1136, 1365, '原生事件 → Adapter → 正文 · 工具活动 · 用量', 18, { color: T.teal.main, anchor: 'middle' });

  const completion = phase(s, 1425, 268, '6', '结束本轮，归还可复用 Host', T.cheese,
    ['原生终态 → AgentRun 结果', '结算执行 · 文件变化投影'],
    '后续 Run 接续工作与会话', ['Native Session 按兼容条件接续', '成果通过显式消息与附件共享'])
    + box(s, 134, 1576, 277, 89, '#fff', P.runtime.border, false, 10)
    + label(272, 1612, 'Detach · 解绑 Lease', 21, { color: P.runtime.main, weight: 600, anchor: 'middle' })
    + label(272, 1645, '检查进程与 CLI 静默', 18, { color: P.runtime.main, anchor: 'middle' })
    + connection('M421 1618 H453', P.runtime, { width: 2.3 })
    + box(s, 466, 1576, 280, 89, '#fff', P.runtime.border, false, 10)
    + label(606, 1612, 'Warm Host · IdleWarm', 21, { color: P.runtime.main, weight: 600, anchor: 'middle' })
    + label(606, 1645, '常驻且可复用', 18, { color: P.runtime.main, anchor: 'middle' })
    + pill(815, 1576, 522, '下一轮：重新 acquire，绑定新的 Lease', P.runtime, 20)
    + label(815, 1649, '其余 Host 结束后回收', 19, { color: P.muted });

  return frame(1720, headings + admission + capability + session + context + running + completion);
}
