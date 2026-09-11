// Semantic layers and illustrative memory cycles; these are not literal payload order or product screenshots.
// Context/Memory details follow context.rs, memory.rs, memory_retrieval.rs and current architecture contracts.
import { P, label, rect, connection } from './system-overview.mjs';
import { T, sketch, box, panel, frame, avatar, pill, bubble, clip, file, envelope, spark } from './collaboration-comics.mjs';

function page(s, x, y, w, h, tone, title = '') {
  return box(s, x, y, w, h, '#fffdf8', tone.main, true, 8)
    + s.path(`M${x + 16} ${y + 21} H${x + w - 17} M${x + 16} ${y + 39} H${x + w - 30}`, tone.border)
    + (title ? label(x + w / 2, y + h - 19, title, 18, { color: tone.main, anchor: 'middle' }) : '');
}

function book(s, x, y, w, h, tone, ruled = true) {
  return s.path(`M${x} ${y + 7} Q${x + w / 4} ${y - 5} ${x + w / 2} ${y + 13} Q${x + w * 3 / 4} ${y - 5} ${x + w} ${y + 7} V${y + h} Q${x + w * 3 / 4} ${y + h - 11} ${x + w / 2} ${y + h + 3} Q${x + w / 4} ${y + h - 11} ${x} ${y + h} Z`, tone.main, '#fffdf4')
    + s.path(`M${x + w / 2} ${y + 13} V${y + h + 2}`, tone.main)
    + (ruled ? [0.3, 0.5, 0.7].map(f => s.path(`M${x + 13} ${y + h * f} H${x + w / 2 - 11} M${x + w / 2 + 12} ${y + h * f} H${x + w - 12}`, tone.border)).join('') : '');
}

function human(s, x, y, size = 1) {
  return `<g transform="translate(${x} ${y}) scale(${size})">`
    + s.circle(0, -12, 19, '#a27c5e', '#f5dfbf')
    + s.path('M-29 48 Q-32 16 0 15 Q32 16 29 48 Z', T.ding.main, '#e6f0f5')
    + '</g>';
}

function contextLayer(s, y, name, token, description, tone, drawing, badge = '') {
  return box(s, 22, y + 5, 1064, 109, tone.border, 'none', false, 13)
    + box(s, 18, y, 1064, 109, tone.soft, tone.main, false, 13)
    + label(43, y + 31, name, 22, { color: tone.main, weight: 600 })
    + label(43, y + 62, token, 18, { color: tone.main })
    + label(43, y + 91, description, 19, { color: P.ink })
    + drawing
    + (badge ? pill(946, y + 10, 113, badge, tone, 15) : '');
}

export function renderLayeredContext() {
  const s = sketch();
  const bootstrap =
    label(21, 34, 'Session Bootstrap · 稳定会话引导', 27, { color: T.green.main, weight: 600 })
    + contextLayer(s, 58, '会话约定', 'Session Charter', '协作约定 · Rovai CLI 入口与使用方式', T.green,
      book(s, 790, 86, 78, 60, T.green)
      + pill(895, 95, 140, 'rovai --help', T.green, 18))
    + contextLayer(s, 186, '队员身份', 'MEMBER_IDENTITY', '自身身份 · 专业职责 · 工作准则 · 成长课题', T.gugu,
      avatar(s, 'gugu', 806, 242, 33)
      + box(s, 872, 207, 180, 66, '#fff', T.gugu.border, false, 9)
      + label(963, 235, '咕咕', 22, { color: T.gugu.main, weight: 600, anchor: 'middle' })
      + label(963, 258, '边界验证与复现', 16, { color: P.muted, anchor: 'middle' }))
    + contextLayer(s, 314, '记忆入口', 'Memory Entrypoint', '按授权范围发现记忆，正文按需读取', T.ding,
      [0, 1, 2].map(i => book(s, 768 + i * 92, 340, 61, 56, [T.green, T.ding, T.gugu][i])).join(''))
    + panel(s, 1139, 58, 347, 365, 'Native Session', T.green)
    + avatar(s, 'gugu', 1312, 218, 57)
    + label(1312, 322, ['建立时注入', '适用时补送'], 21, { color: T.green.main, anchor: 'middle', leading: 40 });

  const dynamic =
    label(21, 483, '动态上下文 · 每次 AgentRun 按需组装', 27, { color: T.teal.main, weight: 600 })
    + contextLayer(s, 514, '同伴名册', 'COLLABORATION_STATE', '可协作对象 · 名片与职责 · 寻址信息', T.gugu,
      avatar(s, 'ding', 819, 568, 31)
      + avatar(s, 'cheese', 961, 568, 31)
      + connection('M864 569 H916', T.gugu, { both: true, width: 2.1 }))
    + contextLayer(s, 642, '自身责任', 'SELF_ACTIVE_TASKS', '我负责的未完成 Task · 目标与进展', T.cheese,
      box(s, 748, 663, 301, 68, '#fffdf4', T.cheese.border, false, 8)
      + label(776, 692, '☐ 导出回归验证', 20, { color: T.cheese.main, weight: 600 })
      + label(776, 716, '检查空数据与边界场景', 17, { color: P.muted }))
    + contextLayer(s, 770, '公共历史', 'SHARED_CONVERSATION', '来源消息 · 引用链 · 最近讨论与成果', T.ding,
      [0, 1, 2].map(i => box(s, 755 + i * 87, 790 + i * 7, 118, 60, '#fff', T.ding.border, false, 8)
        + label(795 + i * 87, 827 + i * 7, ['目标', '反馈', '成果'][i], 17, { color: T.ding.main, anchor: 'middle' })).join(''))
    + contextLayer(s, 898, '本次执行事实', 'RUN_FACTS', '当前 Run · 调用关系 · 关联 Task 与 Gather', T.teal,
      pill(758, 934, 122, 'Caller', T.teal, 19)
      + connection('M887 953 H923', T.teal, { width: 2.1 })
      + pill(932, 934, 116, 'Run', T.teal, 19))
    + contextLayer(s, 1026, '协作指引', 'A2A_GUIDANCE', '按调用场景给出接续与返回提示', T.green,
      avatar(s, 'cheese', 782, 1082, 29)
      + bubble(s, 839, 1050, 210, 61, T.green, 818, 1091)
      + label(857, 1088, '结果交回直属调用者', 18, { color: T.green.main }))
    + contextLayer(s, 1154, '本次输入', 'CURRENT_INPUT', '用户目标或收件消息 · 附件与 Skill 引用', T.cheese,
      avatar(s, 'ding', 790, 1213, 30)
      + envelope(s, 852, 1190, 99, 58, T.cheese)
      + clip(991, 1211, T.cheese, 1.1), '完整保留');

  const selection =
    '<path d="M1100 529 H1114 V1249 H1100 M1114 829 H1130" fill="none" stroke="#9bbdc0" stroke-width="2"/>'
    + panel(s, 1140, 514, 346, 227, 'Context Profile', T.teal)
    + label(1313, 614, ['可见范围 · 输入预算', '选择与裁剪各层内容'], 20, { color: T.teal.main, anchor: 'middle', leading: 42 })
    + connection('M1313 748 V783', T.teal, { width: 2.2 })
    + page(s, 1158, 791, 309, 218, T.green)
    + label(1313, 872, 'ContextManifest', 24, { color: T.green.main, weight: 600, anchor: 'middle' })
    + label(1313, 916, ['实际动态输入', '选择 · 裁剪 · 遗漏'], 20, { color: T.green.main, anchor: 'middle', leading: 38 })
    + connection('M1313 1017 V1071', T.green, { width: 2.2 })
    + avatar(s, 'gugu', 1313, 1137, 54)
    + pill(1216, 1220, 194, '本次 AgentRun', T.gugu, 18);

  return frame(1300, bootstrap + dynamic + selection);
}

export function renderSessionComic() {
  const s = sketch();
  const panels = panel(s, 18, 14, 714, 454, '建立会话，带上稳定引导', T.gugu, '1')
    + panel(s, 758, 14, 728, 454, '每次带来新的工作', T.cheese, '2')
    + panel(s, 18, 495, 714, 503, '长会话，历史逐渐精简', T.ding, '3')
    + panel(s, 758, 495, 728, 503, '接续同一个 Native Session', T.green, '4');

  const start =
    avatar(s, 'gugu', 150, 269, 60, true)
    + book(s, 290, 146, 382, 207, T.gugu, false)
    + label(481, 124, 'Session Bootstrap', 23, { color: T.gugu.main, weight: 600, anchor: 'middle' })
    + label(310, 257, ['协作约定', '身份与职责', '记忆入口'], 21, { color: P.ink, leading: 38 })
    + pill(515, 284, 128, 'Run 1', T.gugu, 19)
    + envelope(s, 554, 224, 61, 37, T.gugu)
    + label(482, 409, '稳定引导 + 首次动态输入', 21, { color: T.gugu.main, anchor: 'middle' });

  const next =
    bubble(s, 829, 104, 563, 87, T.cheese, 887, 217)
    + label(858, 155, '再验证一下空数据场景', 26, { color: P.ink, weight: 600 })
    + avatar(s, 'ding', 870, 287, 49, true)
    + avatar(s, 'gugu', 1381, 323, 49, true)
    + connection('M930 289 H995', T.cheese, { width: 2.3 })
    + envelope(s, 1004, 242, 111, 65, T.cheese)
    + envelope(s, 1133, 286, 111, 65, T.cheese)
    + label(1059, 228, 'Run 2', 19, { color: T.cheese.main, anchor: 'middle' })
    + label(1189, 273, 'Run 3', 19, { color: T.cheese.main, anchor: 'middle' })
    + connection('M1251 320 H1315', T.cheese, { width: 2.3 })
    + label(1108, 411, '每个 Run 获得当前动态上下文', 21, { color: T.cheese.main, anchor: 'middle' });

  const compact =
    label(368, 607, 'Runtime Compaction', 25, { color: T.ding.main, weight: 600, anchor: 'middle' })
    + [0, 1, 2, 3].map(i => page(s, 72 + i * 21, 668 + i * 16, 136, 146, T.ding)).join('')
    + connection('M302 748 H442', T.ding, { width: 2.5 })
    + label(370, 718, '压缩', 22, { color: T.ding.main, anchor: 'middle' })
    + page(s, 466, 668, 192, 173, T.ding, '原生会话摘要')
    + avatar(s, 'gugu', 288, 883, 37)
    + pill(350, 886, 318, '原生压缩信号已接入时', T.ding, 18);

  const continueWork =
    label(1123, 607, 'Bootstrap Redelivery', 25, { color: T.green.main, weight: 600, anchor: 'middle' })
    + page(s, 797, 656, 216, 169, T.green)
    + label(905, 723, ['身份', '约定', '记忆入口'], 20, { color: T.green.main, anchor: 'middle', leading: 37 })
    + label(1063, 747, '+', 42, { color: T.green.main, anchor: 'middle' })
    + envelope(s, 1114, 683, 123, 73, T.cheese)
    + label(1175, 800, '本次动态输入', 20, { color: T.cheese.main, anchor: 'middle' })
    + connection('M1244 723 H1368 V805', T.green, { width: 2.4 })
    + avatar(s, 'gugu', 1368, 869, 52)
    + pill(811, 904, 361, '下一次 Core 受控输入补送', T.green, 19)
    + spark(s, 1430, 806, T.green);

  return frame(1026, panels + start + next + compact + continueWork);
}

export function renderMemoryStudio() {
  const s = sketch();
  const shelf = { main: '#9a825f', soft: '#faf5ea', border: '#d8c6a8' };

  const practice =
    panel(s, 60, 22, 315, 835, '队员主动提报', T.cheese)
    + avatar(s, 'ding', 135, 171, 40)
    + avatar(s, 'cheese', 299, 171, 40)
    + avatar(s, 'gugu', 217, 284, 43)
    + s.path('M143 238 Q212 209 289 238', T.cheese.border)
    + connection('M217 341 V361', T.cheese, { width: 2.4 })
    + box(s, 81, 373, 272, 134, '#fffdf4', T.cheese.border, true, 10)
    + label(104, 408, '实践带来新的经验', 20, { color: T.cheese.main, weight: 600 })
    + label(105, 451, ['导出验证同时覆盖', '空数据与边界场景'], 21, { color: P.ink, leading: 32 })
    + connection('M217 518 V541', T.cheese, { width: 2.4 })
    + pill(99, 552, 237, 'memory.view', T.green, 22)
    + label(218, 629, '先查看完整 Scope', 20, { color: T.green.main, anchor: 'middle' })
    + connection('M217 640 V663', T.teal, { width: 2.4 })
    + pill(99, 674, 237, 'memory.write', T.teal, 22)
    + label(218, 752, ['add / revise', '按 Scope 提报新增或修订'], 20, { color: T.teal.main, anchor: 'middle', leading: 35 });

  const cabinet =
    box(s, 407, 22, 690, 835, shelf.soft, shelf.main, false, 13)
    + box(s, 421, 39, 664, 12, shelf.border, shelf.main, false, 3)
    + label(442, 92, 'Memory Store · 长期记忆书架', 27, { color: shelf.main, weight: 600 })
    + label(443, 135, 'MemoryKind', 20, { color: shelf.main, weight: 600 })
    + pill(443, 154, 192, 'Preference · 偏好', T.green, 17)
    + pill(645, 154, 194, 'Agreement · 约定', T.ding, 17)
    + pill(849, 154, 216, 'Lesson · 经验', T.cheese, 17)
    + box(s, 435, 222, 633, 169, T.green.soft, T.green.border, false, 9)
    + label(460, 260, 'Hearth · 共同记忆', 25, { color: T.green.main, weight: 600 })
    + label(460, 301, '应用内共享 · 跨会话复用', 19, { color: P.ink })
    + pill(459, 335, 233, '共同经验 · 发布后共享', T.green, 16)
    + avatar(s, 'ding', 818, 290, 26)
    + avatar(s, 'gugu', 913, 253, 24)
    + avatar(s, 'cheese', 1007, 290, 26)
    + s.path('M875 359 L943 337 M875 339 L943 360', '#a88049', 'none', { strokeWidth: 5 })
    + s.path('M887 337 Q872 313 901 292 Q897 313 912 316 Q925 304 921 285 Q951 320 931 340 Z', '#c18d37', '#f5c66b')
    + box(s, 435, 419, 633, 169, T.ding.soft, T.ding.border, false, 9)
    + label(460, 457, 'Companion · 队员记忆', 25, { color: T.ding.main, weight: 600 })
    + label(460, 501, ['咕咕积累的偏好、约定与经验', '跨会话 · 跨 Runtime'], 19, { color: P.ink, leading: 33 })
    + book(s, 808, 479, 115, 72, T.ding)
    + avatar(s, 'gugu', 993, 501, 36)
    + box(s, 435, 616, 633, 176, T.gugu.soft, T.gugu.border, false, 9)
    + label(460, 654, 'Relationship · 队员间记忆', 25, { color: T.gugu.main, weight: 600 })
    + label(460, 696, ['两位队员之间的协作经验', 'mutual 双方 / directed 本人方向'], 18, { color: P.ink, leading: 34 })
    + avatar(s, 'cheese', 835, 704, 31)
    + avatar(s, 'gugu', 1002, 704, 31)
    + connection('M876 686 H959', T.gugu, { both: true, width: 2 })
    + connection('M876 725 H959', T.gugu, { width: 2 })
    + [401, 599, 804].map(y => box(s, 420, y, 666, 12, shelf.border, shelf.main, false, 3)).join('')
    + label(751, 843, 'Memory Scope · 决定归属与可见范围', 20, { color: shelf.main, anchor: 'middle' })
    + connection('M345 696 H428', T.teal, { width: 2.8 });

  const lifecycle =
    panel(s, 1145, 22, 341, 835, '记忆持续演进', T.teal)
    + box(s, 1167, 108, 297, 149, '#fff', T.green.border, false, 9)
    + label(1189, 147, 'Hearth · 晋升', 24, { color: T.green.main, weight: 600 })
    + pill(1189, 164, 90, '候选', T.cheese, 17)
    + connection('M1290 183 H1322', T.green, { width: 2.1 })
    + pill(1334, 164, 109, '正式记忆', T.green, 17)
    + label(1315, 234, '用户手动晋升审核', 17, { color: P.muted, anchor: 'middle' })
    + box(s, 1167, 280, 297, 160, '#fff', T.teal.border, false, 9)
    + label(1189, 318, 'Revision · 修订', 24, { color: T.teal.main, weight: 600 })
    + [0, 1, 2].map(i => box(s, 1190 + i * 68, 337, 52, 59, '#fffdf8', T.teal.main, false, 5)
      + s.path(`M${1204 + i * 68} 354 H${1228 + i * 68}`, T.teal.border)
      + label(1216 + i * 68, 381, `v${i + 1}`, 17, { color: T.teal.main, anchor: 'middle' })).join('')
    + connection('M1247 367 H1252', T.teal, { width: 1.5 })
    + connection('M1315 367 H1320', T.teal, { width: 1.5 })
    + label(1190, 421, '同一 Memory 保留版本演进', 17, { color: P.muted })
    + box(s, 1167, 464, 297, 160, '#fff', T.teal.border, false, 9)
    + label(1189, 502, 'Supersession', 24, { color: T.teal.main, weight: 600 })
    + pill(1189, 526, 83, '旧记忆', T.teal, 16)
    + connection('M1283 545 H1331', T.teal, { width: 2 })
    + pill(1343, 526, 95, '新记忆', T.green, 16)
    + label(1190, 601, '显式替代，关联新旧认识', 17, { color: P.muted })
    + box(s, 1167, 648, 297, 171, '#fff', T.teal.border, false, 9)
    + label(1189, 689, 'Retire · Forget', 24, { color: T.teal.main, weight: 600 })
    + box(s, 1200, 716, 65, 49, '#fffdf4', T.teal.main, false, 6)
    + s.path('M1195 715 H1271 M1217 737 H1249', T.teal.main)
    + s.path('M1331 716 L1385 764 M1385 716 L1331 764', T.teal.main)
    + label(1190, 798, '停用旧经验 · 显式遗忘', 18, { color: P.muted })
    + connection('M1137 457 H1105', T.teal, { both: true, width: 2.1 });

  const reuse =
    panel(s, 60, 947, 865, 286, '按需读取，带回下一次实践', T.green)
    + box(s, 557, 1035, 344, 96, '#fff', T.green.border, false, 11)
    + s.circle(585, 1064, 12, T.green.main, '#fff')
    + s.path('M594 1074 l12 13', T.green.main)
    + label(625, 1076, 'FTS5 · memory.search', 21, { color: T.green.main, weight: 600 })
    + label(585, 1110, '仅检索当前有效 Revision', 18, { color: P.muted })
    + connection('M549 1089 H473', T.green, { width: 2.8 })
    + book(s, 333, 1035, 123, 90, T.green)
    + label(394, 1181, 'memory.read', 23, { color: T.green.main, weight: 600, anchor: 'middle' })
    + connection('M319 1089 H210', T.green, { width: 2.8 })
    + avatar(s, 'gugu', 149, 1089, 43)
    + label(149, 1181, '再次实践', 21, { color: T.green.main, anchor: 'middle' })
    + label(729, 1181, '授权范围内发现', 19, { color: T.green.main, anchor: 'middle' });

  const feedback =
    connection('M801 866 V903 Q801 916 788 916 H746 Q729 916 729 933 V1025', T.green, { width: 2.8 })
    + label(955, 908, '当前有效记忆', 19, { color: T.green.main, anchor: 'middle' })
    + connection('M92 1089 H47 Q27 1089 27 1069 V459 Q27 439 47 439 H74', T.green, { width: 3 })
    + label(79, 906, '实践反馈 · 再提报', 20, { color: T.green.main, weight: 600 });

  const growth =
    panel(s, 968, 947, 518, 286, 'growthTopic · 成长课题', T.gugu)
    + book(s, 1001, 1030, 244, 156, T.gugu, false)
    + label(1020, 1078, ['实践方向', '边界验证'], 20, { color: T.gugu.main, leading: 38 })
    + avatar(s, 'gugu', 1180, 1100, 33)
    + label(1349, 1081, ['进入身份引导', '指导后续实践'], 20, { color: T.gugu.main, anchor: 'middle', leading: 44 })
    + connection('M1275 1159 H1446', T.gugu, { width: 2.2 })
    + spark(s, 1433, 1201, T.gugu);

  return frame(1263, practice + cabinet + lifecycle + reuse + growth + feedback);
}
