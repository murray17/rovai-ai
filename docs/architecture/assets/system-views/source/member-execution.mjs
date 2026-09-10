// Figure 02 is an illustrated sketch; Figure 03 follows three conversations.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { P, label, rect, connection } from './system-overview.mjs';

const asset = (relative) => new URL(`../../../../../apps/desktop/src/renderer/src/assets/${relative}`, import.meta.url);

function frame(height, content, extraDefs = '') {
  const tones = Object.values(P).filter(value => typeof value === 'object');
  const markers = tones.map(tone => `<marker id="overview-arrow-${tone.main.slice(1)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 L8 5 L1 9" fill="none" stroke="${tone.main}" stroke-width="1.7"/></marker>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1504" height="${height}" viewBox="0 0 1504 ${height}"><defs>${markers}${extraDefs}</defs><g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">${content}</g></svg>`;
}

function avatarSymbol(id, character) {
  const avatar = readFileSync(asset(`characters/${character}/icon-192.png`)).toString('base64');
  return `<clipPath id="${id}-crop"><circle cx="96" cy="96" r="94"/></clipPath><symbol id="${id}" viewBox="0 0 192 192"><image width="192" height="192" href="data:image/png;base64,${avatar}" clip-path="url(#${id}-crop)"/></symbol>`;
}

function logoSymbol(id, filename) {
  const svg = readFileSync(asset(`runtime-logos/${filename}`), 'utf8');
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
  const contents = svg.replace(/<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/s, '');
  return `<symbol id="${id}" viewBox="${viewBox}">${contents}</symbol>`;
}

function portrait(id, x, y, radius) {
  return `<use href="#${id}" x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}"/>`;
}

// Rough.js uses a fixed seed so the editable SVG and its exports are reproducible.
function sketchTools() {
  const requireTool = createRequire(path.join(path.resolve(process.env.ROVAI_DIAGRAM_TOOLS), 'package.json'));
  const generator = requireTool('roughjs').generator();
  let seed = 20909;
  const draw = (kind, args, color, fill = 'none', options = {}) => generator.toPaths(generator[kind](...args, {
    seed: seed++, stroke: color, strokeWidth: 1.65, roughness: 1.1, bowing: 0.65,
    fill, fillStyle: 'solid', ...options,
  })).map(p => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return {
    box: (x, y, w, h, color, fill, options) => draw('rectangle', [x, y, w, h], color, fill, options),
    ellipse: (x, y, w, h, color, fill, options) => draw('ellipse', [x, y, w, h], color, fill, options),
    line: (x1, y1, x2, y2, color, options) => draw('line', [x1, y1, x2, y2], color, 'none', options),
    path: (d, color, fill, options) => draw('path', [d], color, fill, options),
  };
}

function sketchArrow(s, d, x, y, direction, tone) {
  const heads = {
    right: `M${x - 12} ${y - 7} L${x} ${y} L${x - 12} ${y + 7}`,
    left: `M${x + 12} ${y - 7} L${x} ${y} L${x + 12} ${y + 7}`,
    down: `M${x - 7} ${y - 12} L${x} ${y} L${x + 7} ${y - 12}`,
    up: `M${x - 7} ${y + 12} L${x} ${y} L${x + 7} ${y + 12}`,
  };
  return s.path(d, tone.main) + s.path(heads[direction], tone.main);
}

function human(s, x, y, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">`
    + s.ellipse(0, -10, 40, 42, '#9c765a', '#f6dfc4')
    + s.path('M-31 52 Q-34 19 0 17 Q34 19 31 52 Z', P.access.main, '#dceaf6')
    + s.path('M-18 -18 Q-4 -39 18 -20', '#7c6353')
    + '</g>';
}

function notebook(s, x, y, w = 112, h = 78) {
  return `<g transform="translate(${x} ${y})">`
    + s.path(`M0 8 Q${w * 0.25} -3 ${w / 2} 11 Q${w * 0.75} -3 ${w} 8 V${h} Q${w * 0.75} ${h - 9} ${w / 2} ${h + 2} Q${w * 0.25} ${h - 9} 0 ${h} Z`, P.memory.main, '#fffdf2')
    + s.line(w / 2, 11, w / 2, h + 2, P.memory.main)
    + [26, 43, 60].map(yy => s.line(12, yy, w / 2 - 10, yy - 1, '#bccbaa') + s.line(w / 2 + 12, yy - 1, w - 12, yy, '#bccbaa')).join('')
    + '</g>';
}

function chatWindow(s, x, y, title, variant) {
  const tone = P.peer;
  let picture = s.box(x, y, 330, 188, tone.main, '#faf7fd')
    + s.line(x, y + 48, x + 330, y + 48, tone.border)
    + label(x + 23, y + 34, title, 24, { color: tone.main, weight: 600 })
    + [0, 1, 2].map(i => s.ellipse(x + 276 + i * 16, y + 25, 5, 5, tone.main, tone.main)).join('')
    + portrait('gugu-avatar', x + 41, y + 85, 20)
    + s.path(`M${x + 78} ${y + 69} H${x + 274} Q${x + 288} ${y + 69} ${x + 288} ${y + 82} V${y + 106} H${x + 90} L${x + 78} ${y + 115} Z`, tone.border, '#fff');
  if (variant === 'checks') {
    picture += [0, 1, 2].map(i => s.path(`M${x + 93 + i * 64} ${y + 89} l5 5 l10 -12`, P.context.main)
      + s.line(x + 114 + i * 64, y + 88, x + 138 + i * 64, y + 88, tone.border)).join('');
  } else {
    picture += s.box(x + 91, y + 80, 31, 17, P.toolkit.main, P.toolkit.soft)
      + s.line(x + 134, y + 82, x + 266, y + 82, tone.border)
      + s.line(x + 134, y + 96, x + 224, y + 96, tone.border);
  }
  return picture
    + s.path(`M${x + 114} ${y + 134} H${x + 281} V${y + 162} H${x + 130} L${x + 114} ${y + 170} Z`, P.resource.border, '#fff')
    + s.line(x + 129, y + 148, x + 258, y + 148, P.resource.border);
}

function runtimeCard(s, x, y, name, id, angle) {
  const color = name === 'Codex' ? P.runtime : { ...P.runtime, main: '#bf795d', soft: '#fdf4ec' };
  return `<g transform="rotate(${angle} ${x + 144} ${y + 82})">`
    + s.box(x, y, 288, 164, color.main, color.soft)
    + `<use href="#${id}" x="${x + 34}" y="${y + 27}" width="78" height="78"/>`
    + label(x + 135, y + 78, name, name === 'Codex' ? 28 : 22, { color: P.ink, weight: 600 })
    + s.path(`M${x + 139} ${y + 101} h84`, color.main)
    + '</g>';
}

export function renderIdentityRuntime() {
  const s = sketchTools();
  const defs = avatarSymbol('gugu-avatar', 'mianzhi') + avatarSymbol('cheese-avatar', 'muwa')
    + logoSymbol('codex-logo', 'codex-color.svg') + logoSymbol('claude-code-logo', 'claudecode-color.svg');
  const connections =
    sketchArrow(s, 'M650 255 C528 241 541 170 419 171', 419, 171, 'left', P.peer)
    + sketchArrow(s, 'M647 315 C526 326 542 429 419 429', 419, 429, 'left', P.peer)
    + sketchArrow(s, 'M854 258 C986 243 962 174 1103 174', 1103, 174, 'right', P.runtime)
    + sketchArrow(s, 'M855 321 C976 343 979 431 1103 431', 1103, 431, 'right', P.runtime)
    + s.path('M752 438 Q750 485 752 536 L752 574', P.memory.main)
    + s.path('M752 574 Q514 579 273 574 L273 610', P.memory.main)
    + s.path('M752 574 Q993 578 1231 574 L1231 610', P.memory.main)
    + s.path('M752 574 V610', P.memory.main)
    + [273, 752, 1231].map(x => s.ellipse(x, 610, 8, 8, P.memory.main, '#fff')).join('');

  const center =
    s.ellipse(752, 286, 224, 218, P.peer.main, P.peer.soft, { fillStyle: 'hachure', hachureGap: 12, fillWeight: 0.6 })
    + portrait('gugu-avatar', 752, 280, 88)
    + label(752, 422, '咕咕', 36, { color: P.peer.main, weight: 600, anchor: 'middle' })
    + s.path('M712 435 Q753 441 790 434', P.peer.main);

  const top =
    chatWindow(s, 67, 75, '会话一', 'checks')
    + chatWindow(s, 67, 344, '会话二', 'layout')
    + runtimeCard(s, 1127, 89, 'Codex', 'codex-logo', -2)
    + runtimeCard(s, 1127, 355, 'Claude Code', 'claude-code-logo', 2)
    + sketchArrow(s, 'M1223 267 C1198 281 1197 318 1223 334', 1223, 334, 'right', P.runtime)
    + sketchArrow(s, 'M1329 334 C1354 318 1354 281 1329 267', 1329, 267, 'left', P.runtime)
    + label(1277, 310, '切换', 22, { color: P.runtime.main, anchor: 'middle' });

  const hearth =
    s.ellipse(273, 820, 302, 105, P.memory.border, '#f2f6e8')
    + portrait('gugu-avatar', 166, 721, 36)
    + portrait('cheese-avatar', 380, 721, 36)
    + human(s, 273, 684, 0.9)
    + label(273, 642, '用户', 17, { color: P.muted, anchor: 'middle' })
    + s.path('M215 827 L329 855 M219 854 L328 825', '#a97849', 'none', { strokeWidth: 7, roughness: 0.9 })
    + s.path('M240 827 Q220 796 257 768 Q251 795 272 799 Q293 780 284 747 Q333 791 310 823 Q279 849 240 827 Z', '#d48b35', '#f3b94c')
    + s.path('M259 827 Q247 811 274 788 Q265 812 289 810 Q303 834 277 837 Z', '#dfa74b', '#ffe4a0')
    + s.path('M191 765 Q206 785 215 808 M350 765 Q337 785 329 808', P.memory.main)
    + label(273, 929, '共同记忆', 29, { color: P.memory.main, weight: 600, anchor: 'middle' });

  const companion =
    s.ellipse(752, 820, 318, 100, P.memory.border, '#f2f6e8')
    + portrait('gugu-avatar', 752, 710, 53)
    + s.path('M710 756 Q691 779 702 804 M794 756 Q813 779 802 804', P.memory.main)
    + notebook(s, 679, 789, 146, 81)
    + s.box(622, 729, 43, 51, P.memory.border, '#fffdf2')
    + s.path('M632 753 l8 8 l14 -20', P.memory.main)
    + s.box(841, 727, 43, 51, P.memory.border, '#fffdf2')
    + s.path('M851 743 h22 M851 755 h16 M851 767 h22', P.memory.main)
    + label(752, 929, '队员记忆', 29, { color: P.memory.main, weight: 600, anchor: 'middle' });

  const relationship =
    s.ellipse(1231, 820, 327, 100, P.memory.border, '#f2f6e8')
    + portrait('gugu-avatar', 1139, 726, 45)
    + portrait('cheese-avatar', 1323, 726, 45)
    + sketchArrow(s, 'M1187 698 Q1231 670 1275 698', 1275, 698, 'right', P.memory)
    + sketchArrow(s, 'M1275 755 Q1231 783 1187 755', 1187, 755, 'left', P.memory)
    + s.box(1178, 794, 63, 57, P.memory.main, '#fffdf2')
    + s.box(1219, 811, 64, 58, P.memory.main, '#e1edd6')
    + s.path('M1191 811 h32 M1191 825 h20 M1231 828 h37 M1231 843 h24', P.memory.main)
    + label(1231, 929, '队员间记忆', 29, { color: P.memory.main, weight: 600, anchor: 'middle' });

  return frame(972, connections + center + top + hearth + companion + relationship, defs);
}

function tag(x, y, w, title, tone, size = 18) {
  return rect(x, y, w, 32, tone.soft, tone.border, 8)
    + label(x + w / 2, y + 23, title, size, { color: tone.main, weight: 600, anchor: 'middle' });
}

function fileIcon(x, y, tone, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 0 H19 L28 9 V37 H0 Z M19 0 V9 H28 M6 18 H21 M6 25 H19" fill="${tone.soft}" stroke="${tone.main}" stroke-width="1.7" stroke-linejoin="round"/></g>`;
}

function paperclip(x, y, tone) {
  return `<path d="M${x + 7} ${y + 20} l13 -13 a5 5 0 0 1 7 7 l-17 17 a8 8 0 0 1 -11 -11 l17 -17" fill="none" stroke="${tone.main}" stroke-width="2.3" stroke-linecap="round"/>`;
}

function participant(x, name, role, tone) {
  return rect(x - 190, 10, 380, 102, tone.soft, tone.border, 14)
    + label(x, 47, name, 27, { color: tone.main, weight: 600, anchor: 'middle' })
    + label(x, 79, role, 20, { color: P.ink, anchor: 'middle' })
    + label(x, 141, `Conversation ${name.slice(-1)}`, 17, { color: tone.main, anchor: 'middle' });
}

function runCard(x, y, w, h, id, action, tone, artifact) {
  return rect(x, y, w, h, '#fff', tone.border, 11)
    + rect(x, y + 13, 4, h - 26, tone.main, 'none', 2)
    + label(x + 20, y + 28, `Run ${id}`, 16, { color: tone.main, weight: 600 })
    + label(x + 20, y + 61, action, 22, { color: P.ink, weight: 600 })
    + (artifact ? fileIcon(x + 21, y + 81, tone, 0.62) + label(x + 49, y + 99, artifact, 17, { color: P.muted }) : '');
}

function message(x, y, recipient, action, tone) {
  return tag(x, y, 66, recipient, tone)
    + label(x + 80, y + 23, action, 20, { color: tone.main });
}

export function renderConversationRuns() {
  const a = P.peer;
  const b = P.toolkit;
  const c = P.responsibility;
  const columns = [[250, a], [752, b], [1254, c]];
  const lines = columns.map(([x, tone]) => `<path d="M${x} 159 V1385" stroke="${tone.border}" stroke-width="2.4" stroke-dasharray="6 9"/>`).join('');
  const headers = participant(250, '队员 A', '方案 · 编码', a)
    + participant(752, '队员 B', '原型设计', b)
    + participant(1254, '队员 C', '方案评审 · Code Review', c);

  const arrows =
    // A publishes one message with two recipients; each gets its own execution.
    connection('M250 314 V367 H1254', a, { arrow: false, width: 2.6 })
    + connection('M752 367 V410', a, { width: 2.6 })
    + connection('M1254 367 V410', a, { width: 2.6 })
    + `<circle cx="752" cy="367" r="5" fill="${a.main}"/>`
    // Separate return messages cause separate continuation runs for A.
    + connection('M1254 508 V567 H444', c, { width: 2.6 })
    + connection('M752 508 V747 H444', b, { width: 2.6 })
    + connection('M250 882 V930 H1254 V1015', a, { width: 2.6 })
    + connection('M1254 1113 V1184 H444', c, { width: 2.6 });

  const multiMention =
    rect(477, 274, 703, 65, a.soft, a.border, 11)
    + tag(497, 290, 64, '@B', a)
    + tag(570, 290, 64, '@C', a)
    + label(653, 314, 'B 做原型，C 审方案', 22, { color: a.main, weight: 600 })
    + label(1141, 314, '同一条消息', 17, { color: P.muted, anchor: 'end' });

  const runs =
    runCard(56, 182, 388, 132, 'A₁', '输出功能方案', a, '导出方案.md')
    + runCard(580, 410, 344, 98, 'B₁', '制作交互原型', b)
    + runCard(1082, 410, 344, 98, 'C₁', '评审方案', c)
    + runCard(56, 540, 388, 86, 'A₂', '接收方案评审意见', a)
    + runCard(56, 720, 388, 162, 'A₃', '结合原型与评审完成编码', a, 'ExportButton.tsx')
    + runCard(1082, 1015, 344, 98, 'C₂', 'Code Review', c)
    + runCard(56, 1157, 388, 132, 'A₄', '修订代码，完成交付', a, 'CSV 导出功能');

  const prototype =
    message(464, 617, '@A', '原型交回', b)
    + rect(461, 659, 267, 71, '#fff', b.border, 9)
    + paperclip(478, 671, b)
    + label(517, 685, 'export-prototype.html', 17, { color: b.main, weight: 600 })
    + label(517, 713, '附件 · 可交互预览', 16, { color: P.muted })
    // The thumbnail is part of B's attached prototype, not another participant.
    + rect(815, 615, 393, 185, '#fff', b.border, 10)
    + rect(815, 615, 393, 32, b.soft, b.border, 10)
    + label(834, 637, '原型预览', 14, { color: b.main })
    + label(837, 686, '报表', 22, { color: P.ink, weight: 600 })
    + rect(1070, 661, 116, 35, b.main, b.main, 6)
    + label(1128, 685, '导出 CSV', 16, { color: '#fff', weight: 600, anchor: 'middle' })
    + [0, 1, 2].map(i => rect(837, 710 + i * 24, 348, 15, i % 2 ? '#f5f8f8' : '#eaf2f2', 'none', 3)).join('')
    + connection('M759 689 H815', b, { arrow: false, dashed: true });

  const messages =
    message(711, 523, '@A', '方案评审：补充大数据量场景', c)
    + message(532, 885, '@C', '代码已完成，请评审实现', a)
    + message(711, 1140, '@A', 'Code Review：补齐空数据处理', c);

  return frame(1410, lines + headers + arrows + multiMention + runs + prototype + messages);
}
