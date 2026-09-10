// Illustrated mechanism views. Panels describe concepts, not screenshots of product UI.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { P, label, rect, connection } from './system-overview.mjs';

export const T = {
  ding: { main: '#477d9d', soft: '#eef6fb', border: '#b5cfde' },
  cheese: { main: '#b77942', soft: '#fff6e8', border: '#e4c8a2' },
  gugu: { main: '#8064b4', soft: '#f6f0fb', border: '#cfbfe2' },
  green: { main: '#528867', soft: '#f1f7ee', border: '#bfd7b8' },
  teal: P.toolkit,
};
const edgeInk = '#666050';

export function sketch() {
  const requireTool = createRequire(path.join(path.resolve(process.env.ROVAI_DIAGRAM_TOOLS), 'package.json'));
  const generator = requireTool('roughjs').generator();
  let seed = 40905;
  const draw = (type, values, color = edgeInk, fill = 'none', more = {}) => generator.toPaths(generator[type](...values, {
    seed: seed++, stroke: color, strokeWidth: 2, roughness: 0.85, bowing: 0.65, fill, fillStyle: 'solid', ...more,
  })).map(p => `<path d="${p.d}" fill="${p.fill ?? 'none'}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return {
    path: (d, stroke, fill, more) => draw('path', [d], stroke, fill, more),
    circle: (x, y, r, stroke, fill, more) => draw('circle', [x, y, r * 2], stroke, fill, more),
    ellipse: (x, y, w, h, stroke, fill, more) => draw('ellipse', [x, y, w, h], stroke, fill, more),
  };
}

function roundPath(x, y, w, h, r = 16) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

export function box(s, x, y, w, h, fill = '#fff', stroke = edgeInk, shadow = false, radius = 16) {
  return (shadow ? s.path(roundPath(x + 5, y + 5, w, h, radius), 'none', '#e8e5dc') : '')
    + s.path(roundPath(x, y, w, h, radius), stroke, fill);
}

export function panel(s, x, y, w, h, title, tone, index = '') {
  return box(s, x, y, w, h, tone.soft, tone.border, false, 20)
    + (index ? s.circle(x + 34, y + 38, 17, tone.main, '#fff') + label(x + 34, y + 45, index, 18, { color: tone.main, anchor: 'middle', weight: 700 }) : '')
    + label(x + (index ? 67 : 28), y + 47, title, 26, { color: tone.main, weight: 600 });
}

function defs() {
  const markers = Object.values({ ...T, ...P }).filter(v => typeof v === 'object')
    .filter((v, i, a) => a.findIndex(t => t.main === v.main) === i)
    .map(t => `<marker id="overview-arrow-${t.main.slice(1)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 L8 5 L1 9" fill="none" stroke="${t.main}" stroke-width="1.7"/></marker>`).join('');
  const avatars = [['ding', 'luoke'], ['cheese', 'muwa'], ['gugu', 'mianzhi']].map(([id, character]) => {
    const image = readFileSync(new URL(`../../../../../apps/desktop/src/renderer/src/assets/characters/${character}/icon-192.png`, import.meta.url)).toString('base64');
    return `<clipPath id="comic-${id}-crop"><circle cx="96" cy="96" r="94"/></clipPath><symbol id="comic-${id}" viewBox="0 0 192 192"><image width="192" height="192" href="data:image/png;base64,${image}" clip-path="url(#comic-${id}-crop)"/></symbol>`;
  }).join('');
  return markers + avatars;
}

export function frame(height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1504" height="${height}" viewBox="0 0 1504 ${height}"><defs>${defs()}</defs><g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">${content}</g></svg>`;
}

export function avatar(s, id, x, y, r = 45, named = false) {
  const names = { ding: '叮叮', cheese: '芝士', gugu: '咕咕' };
  return s.ellipse(x + 3, y + r + 5, r * 1.5, 13, 'none', '#e2e5dc')
    + `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="#fff" stroke="${T[id].border}" stroke-width="2"/>`
    + `<use href="#comic-${id}" x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}"/>`
    + (named ? label(x, y + r + 40, names[id], 25, { color: T[id].main, weight: 600, anchor: 'middle' }) : '');
}

export function pill(x, y, w, text, tone, size = 18) {
  const h = Math.max(33, Math.ceil(size * 1.4) + 8);
  return rect(x, y, w, h, '#fff', tone.border, 10, 1.5)
    + label(x + w / 2, y + Math.round(h / 2 + size * 0.4), text, size, { color: tone.main, weight: 600, anchor: 'middle' });
}

export function bubble(s, x, y, w, h, tone, tailX, tailY) {
  return s.path(`M${x + 22} ${y + h - 32} L${tailX} ${tailY} L${x + 70} ${y + h - 3} Z`, tone.main, '#fff')
    + box(s, x, y, w, h, '#fff', tone.main, false, 22);
}

export function clip(x, y, tone, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M9 20 L23 6 A6 6 0 0 1 31 15 L13 33 A9 9 0 0 1 0 20 L19 1" fill="none" stroke="${tone.main}" stroke-width="2.5" stroke-linecap="round"/></g>`;
}

export function file(s, x, y, w, title, tone, subtitle = '') {
  return box(s, x, y, w, subtitle ? 86 : 68, '#fff', tone.border, true, 11)
    + clip(x + 20, y + 17, tone, 0.8)
    + label(x + 56, y + 39, title, 19, { color: tone.main, weight: 600 })
    + (subtitle ? label(x + 56, y + 67, subtitle, 16, { color: P.muted }) : '');
}

export function envelope(s, x, y, w, h, tone) {
  return box(s, x, y, w, h, '#fffdf8', tone.main, false, 8)
    + s.path(`M${x + 3} ${y + 3} L${x + w / 2} ${y + h * 0.58} L${x + w - 3} ${y + 3}`, tone.main)
    + s.path(`M${x + 3} ${y + h - 3} L${x + w * 0.32} ${y + h * 0.48} M${x + w - 3} ${y + h - 3} L${x + w * 0.68} ${y + h * 0.48}`, tone.border);
}

export function spark(s, x, y, tone) {
  return s.path(`M${x} ${y - 13} V${y - 5} M${x} ${y + 5} V${y + 13} M${x - 13} ${y} H${x - 5} M${x + 5} ${y} H${x + 13}`, tone.main);
}

export function renderA2AComic() {
  const s = sketch();
  const panels = panel(s, 18, 14, 714, 465, '发出明确请求', T.ding, '1')
    + panel(s, 758, 14, 728, 465, '公开讨论，定向投递', T.teal, '2')
    + panel(s, 18, 505, 714, 497, '同伴也可以继续委托', T.cheese, '3')
    + panel(s, 758, 505, 728, 497, '返回直属调用者', T.gugu, '4');

  const first =
    avatar(s, 'ding', 142, 276, 62, true)
    + bubble(s, 255, 127, 419, 137, T.ding, 211, 278)
    + pill(280, 147, 110, '@芝士', T.cheese, 20)
    + label(279, 228, '请审一下导出方案', 27, { color: P.ink, weight: 600 })
    + file(s, 331, 313, 311, '导出方案.md', T.ding, '随消息一起交付')
    + pill(60, 409, 159, 'CLI · send', T.ding, 18)
    + spark(s, 206, 197, T.ding);

  const second =
    pill(1060, 94, 126, 'Core', T.teal, 22)
    + connection('M1123 134 V142 H944 V169', T.teal, { width: 2.3 })
    + connection('M1123 142 H1178 V246 H1224', T.teal, { width: 2.3 })
    + box(s, 799, 169, 294, 194, '#fff', T.teal.border, true, 12)
    + label(945, 207, '一条公共消息', 23, { color: T.teal.main, weight: 600, anchor: 'middle' })
    + s.path('M823 223 H1069', T.teal.border)
    + label(822, 259, '叮叮 → @芝士', 22, { color: P.ink })
    + clip(823, 284, T.teal, 0.7)
    + label(858, 307, '导出方案.md', 19, { color: P.muted })
    + avatar(s, 'ding', 848, 407, 22)
    + avatar(s, 'gugu', 913, 407, 22)
    + label(958, 416, '可见', 20, { color: T.teal.main })
    + label(1296, 181, '芝士的 Delivery', 22, { color: T.teal.main, weight: 600, anchor: 'middle' })
    + envelope(s, 1229, 211, 134, 73, T.teal)
    + connection('M1296 289 V313', T.teal, { width: 2.3 })
    + avatar(s, 'cheese', 1296, 365, 45)
    + pill(1214, 431, 164, '芝士 · 新 Run', T.cheese, 18);

  const third =
    bubble(s, 254, 596, 419, 133, T.cheese, 206, 746)
    + pill(279, 615, 112, '@咕咕', T.gugu, 20)
    + label(278, 695, '帮我复现空数据导出', 26, { color: P.ink, weight: 600 })
    + connection('M210 790 C326 749 404 767 506 807', T.cheese, { width: 2.4 })
    + label(354, 754, '继续委托', 20, { color: T.cheese.main, anchor: 'middle' })
    + avatar(s, 'cheese', 141, 794, 57, true)
    + avatar(s, 'gugu', 579, 828, 57, true)
    + file(s, 267, 852, 224, '复现样例.csv', T.cheese)
    + spark(s, 650, 760, T.gugu);

  const fourth =
    label(1456, 552, 'Caller Return', 20, { color: T.gugu.main, anchor: 'end' })
    + connection('M937 737 H1058', T.gugu, { width: 2.6 })
    + connection('M1176 737 H1311', T.cheese, { width: 2.6 })
    + avatar(s, 'gugu', 879, 737, 45, true)
    + avatar(s, 'cheese', 1118, 737, 45, true)
    + avatar(s, 'ding', 1370, 737, 45, true)
    + pill(940, 666, 114, '@芝士', T.gugu, 20)
    + pill(1186, 666, 114, '@叮叮', T.cheese, 20)
    + clip(981, 785, T.gugu, 0.72)
    + clip(1230, 785, T.cheese, 0.72)
    + label(997, 858, '复现记录.md', 18, { color: T.gugu.main, anchor: 'middle' })
    + label(1244, 858, '评审结论.md', 18, { color: T.cheese.main, anchor: 'middle' })
    + pill(1042, 905, 151, '新 Run · 评审', T.cheese, 17)
    + pill(1294, 905, 151, '新 Run · 修订', T.ding, 17)
    + spark(s, 1425, 676, T.ding);

  return frame(1030, panels + first + second + third + fourth);
}

function taskCard(s, x, y, w, id, title, owner, criteria, status) {
  const tone = T[owner];
  return box(s, x, y, w, 132, '#fffef9', T.cheese.border, true, 11)
    + s.path(`M${x + w / 2 - 24} ${y - 7} h48 v17 h-48 Z`, 'none', '#eee4c1')
    + label(x + 20, y + 35, id, 16, { color: T.cheese.main, weight: 600 })
    + pill(x + w - 112, y + 15, 92, status, tone, 16)
    + label(x + 20, y + 69, title, 23, { color: P.ink, weight: 600 })
    + avatar(s, owner, x + 37, y + 104, 17)
    + label(x + 66, y + 111, criteria, 17, { color: P.muted });
}

function book(s, x, y, title, skill, owners, kind, angle) {
  const tone = kind === 'fire' ? T.cheese : kind === 'check' ? T.green : T.gugu;
  return `<g transform="rotate(${angle} ${x + 78} ${y + 103})">`
    + box(s, x + 5, y + 5, 149, 208, '#fff', tone.border, false, 9)
    + box(s, x, y, 149, 208, tone.soft, tone.main, false, 9)
    + s.path(`M${x + 15} ${y + 5} V${y + 203}`, tone.border)
    + label(x + 82, y + 43, title, 21, { color: tone.main, weight: 600, anchor: 'middle' })
    + owners.map((id, i) => avatar(s, id, x + (owners.length === 3 ? 42 + i * 37 : 52 + i * 54), y + 91, 20)).join('')
    + (kind === 'fire' ? s.path(`M${x + 65} ${y + 152} Q${x + 55} ${y + 132} ${x + 81} ${y + 116} Q${x + 75} ${y + 134} ${x + 88} ${y + 137} Q${x + 104} ${y + 149} ${x + 91} ${y + 158} Z`, tone.main, '#f2ba68')
      : kind === 'check' ? s.path(`M${x + 57} ${y + 137} l15 15 l33 -31`, tone.main, 'none', { strokeWidth: 3.3 })
        : label(x + 82, y + 159, '?', 45, { color: tone.main, weight: 600, anchor: 'middle' }))
    + label(x + 82, y + 190, skill, 16, { color: tone.main, anchor: 'middle' })
    + '</g>';
}

export function renderOrganizationComic() {
  const s = sketch();
  const panels = panel(s, 18, 14, 838, 530, '对等协作 · 轻量 Lead', T.ding)
    + panel(s, 880, 14, 606, 530, 'Task · 跨 Run 的责任', T.cheese)
    + panel(s, 18, 574, 608, 434, 'Skill · 按需选择协作方法', T.gugu)
    + panel(s, 650, 574, 836, 434, 'Gather · 同题并行，一次汇总', T.green);

  const peers =
    bubble(s, 56, 97, 328, 91, T.ding, 179, 235)
    + label(79, 132, '用户：把 CSV 导出做完整', 22, { color: P.ink, weight: 600 })
    + label(79, 164, '未指定接收者 → Default Lead', 16, { color: P.muted })
    + connection('M266 256 C364 218 456 183 553 201', T.ding, { width: 2.4, both: true })
    + label(450, 181, '咨询 · 委托', 19, { color: T.ding.main, anchor: 'middle' })
    + connection('M625 265 C674 286 693 327 692 351', T.cheese, { width: 2.4, both: true })
    + label(750, 308, '直接协作', 19, { color: T.cheese.main, anchor: 'middle' })
    + connection('M626 406 C508 474 372 436 262 334', T.gugu, { width: 2.4, both: true })
    + label(441, 470, '反馈 · 成果', 19, { color: T.gugu.main, anchor: 'middle' })
    + avatar(s, 'ding', 204, 293, 58, true)
    + avatar(s, 'cheese', 619, 205, 58, true)
    + avatar(s, 'gugu', 696, 416, 58, true)
    + pill(112, 412, 184, '本次 Default Lead', T.ding, 16)
    + label(204, 482, ['承接 · 协调 · 收口'], 20, { color: T.ding.main, anchor: 'middle' })
    // Shared artifacts sit on a drawn worktable between peers.
    + s.ellipse(440, 352, 227, 68, '#c4b792', '#fcf6dd')
    + s.path('M350 375 l-8 28 M526 375 l8 28', '#c4b792')
    + box(s, 352, 308, 99, 56, '#fff', T.ding.border, false, 6)
    + label(402, 343, '方案', 19, { color: T.ding.main, anchor: 'middle' })
    + box(s, 461, 333, 84, 56, '#fff', T.green.border, false, 6)
    + label(503, 369, '成果', 19, { color: T.green.main, anchor: 'middle' })
    + label(817, 101, 'A2A · Core 路由', 16, { color: P.muted, anchor: 'end' });

  const tasks =
    taskCard(s, 910, 111, 542, 'Task 01', '完成 CSV 导出功能', 'ding', '叮叮 · 验收：空数据 / 中文 / 大数据量', '进行中')
    + taskCard(s, 910, 273, 542, 'Task 02', '建立导出回归验证', 'gugu', '咕咕 · 验收：样例集 + 验证报告', '待开始')
    + label(918, 449, '用户 / Lead 定义责任，负责人更新进展', 20, { color: T.cheese.main })
    + pill(914, 475, 124, 'Task 关联', T.cheese, 17)
    + connection('M1045 491 H1122', T.cheese, { dashed: true, arrow: false })
    + envelope(s, 1130, 473, 58, 35, T.ding)
    + label(1200, 498, '消息', 18, { color: T.ding.main })
    + connection('M1247 491 H1305', T.ding, { width: 2.1 })
    + pill(1312, 475, 114, '新 Run', T.ding, 18);

  const methods =
    book(s, 54, 673, '多人讨论', 'campfire', ['ding', 'cheese', 'gugu'], 'fire', -4)
    + book(s, 245, 665, '双人评审', 'review-duo', ['cheese', 'gugu'], 'check', 2)
    + book(s, 433, 674, '双人追问', 'grill-duo', ['ding', 'cheese'], 'question', -2)
    + label(323, 948, '分工 · 轮次 · 评审方式', 23, { color: T.gugu.main, anchor: 'middle' });

  const gather =
    bubble(s, 685, 662, 387, 60, T.green, 775, 756)
    + label(879, 701, '共同请求：导出功能能发布了吗？', 21, { color: T.green.main, weight: 600, anchor: 'middle' })
    + connection('M800 818 H833 V772 H875', T.ding, { width: 2.2 })
    + connection('M833 818 V905 H875', T.ding, { width: 2.2 })
    + avatar(s, 'ding', 745, 818, 43, true)
    + label(745, 934, 'Lead 发起', 17, { color: T.ding.main, anchor: 'middle' })
    + box(s, 880, 738, 204, 82, '#fff', T.cheese.border, false, 10)
    + avatar(s, 'cheese', 919, 779, 25)
    + label(959, 772, '芝士', 21, { color: T.cheese.main, weight: 600 })
    + label(959, 802, '责任已结束', 16, { color: P.muted })
    + box(s, 880, 867, 204, 82, '#fff', T.gugu.border, false, 10)
    + avatar(s, 'gugu', 919, 908, 25)
    + label(959, 901, '咕咕', 21, { color: T.gugu.main, weight: 600 })
    + label(959, 931, '责任已结束', 16, { color: P.muted })
    + connection('M1085 779 H1121 V841 H1150', T.cheese, { width: 2.1 })
    + connection('M1085 908 H1121 V841', T.gugu, { width: 2.1, arrow: false })
    + box(s, 1155, 794, 127, 107, '#fff', T.green.border, false, 11)
    + envelope(s, 1175, 811, 74, 42, T.green)
    + envelope(s, 1188, 833, 74, 42, T.green)
    + label(1219, 759, '全部结束', 18, { color: T.green.main, weight: 600, anchor: 'middle' })
    + label(1219, 941, '结果汇集', 19, { color: T.green.main, anchor: 'middle' })
    + connection('M1287 841 H1335', T.green, { width: 2.4 })
    + avatar(s, 'ding', 1400, 841, 43, true)
    + pill(1328, 932, 144, '一次汇总 Run', T.ding, 16);

  return frame(1036, panels + peers + tasks + methods + gather);
}
