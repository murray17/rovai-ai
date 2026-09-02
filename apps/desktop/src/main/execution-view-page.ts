export const EXECUTION_VIEW_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Rovai AI · 只读执行台</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #eceeef;
      --surface: #fbfbfa;
      --surface-raised: #ffffff;
      --surface-subtle: #f0f2f4;
      --surface-muted: #e7eaed;
      --surface-hover: #e8eaea;
      --conversation-surface: #ffffff;
      --execution-running-surface: #fafafa;
      --ink: #171b20;
      --muted: #616a73;
      --faint: #6e7382;
      --line: #dfe4e8;
      --line-strong: #c7cfd6;
      --control-line: #8b9389;
      --brand: #526f88;
      --brand-soft: #e9eef3;
      --brand-ink: #405f7e;
      --rail-logo: #526f88;
      --ember: #d3a45f;
      --success: #3e775c;
      --success-soft: #e7f1ea;
      --danger: #a24c46;
      --danger-soft: #f7e6e3;
      --attention: #8a6226;
      --attention-soft: #f8edda;
      --info: #416c86;
      --info-soft: #e5eef3;
      --neutral-soft: #ecefe9;
      --focus: #526f88;
      --evidence-canvas: #f4f6f3;
      --evidence-surface: #ffffff;
      --evidence-ink: #252a36;
      --evidence-muted: #5f6678;
      --evidence-line: #d5dad3;
      --shell-result-canvas: #f3f4f3;
      --diff-add: #137333;
      --diff-remove: #b3261e;
      --identity-user: #405f7e;
      --identity-agent: #547245;
      --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --canvas: #0d1114;
        --surface: #151a1e;
        --surface-raised: #1b2227;
        --surface-subtle: #1a2024;
        --surface-muted: #242d33;
        --surface-hover: #1d252b;
        --conversation-surface: #181d21;
        --execution-running-surface: #1b2024;
        --ink: #e7ecef;
        --muted: #abb5bc;
        --faint: #919da6;
        --line: #333e46;
        --line-strong: #53616b;
        --control-line: #687b88;
        --brand: #7897ae;
        --brand-soft: #22303a;
        --brand-ink: #c0d4e1;
        --rail-logo: #b1c8d8;
        --ember: #d2aa72;
        --success: #82b695;
        --success-soft: #1a2b22;
        --danger: #d6857f;
        --danger-soft: #321e1d;
        --attention: #d2ac70;
        --attention-soft: #302719;
        --info: #83afc9;
        --info-soft: #182832;
        --neutral-soft: #242d33;
        --focus: #8fb3cb;
        --evidence-canvas: #12191d;
        --evidence-surface: #171f24;
        --evidence-ink: #dce4e9;
        --evidence-muted: #9eabb3;
        --evidence-line: #35424a;
        --shell-result-canvas: #373f43;
        --diff-add: #92c7a5;
        --diff-remove: #e09a94;
        --identity-user: #c0d4e1;
        --identity-agent: #89a878;
      }
    }

    * { box-sizing: border-box; }
    html, body { min-width: 320px; min-height: 100%; margin: 0; }
    html { background: var(--canvas); }
    body { color: var(--ink); background: var(--conversation-surface); font-family: var(--sans); font-size: 13px; line-height: 1.6; text-rendering: optimizeLegibility; }
    button { color: inherit; font: inherit; }
    button, summary { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    :where(button, summary, [tabindex]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    ::selection { color: var(--ink); background: var(--brand-soft); }
    .skip { position: fixed; z-index: 30; top: 8px; left: 8px; padding: 8px 10px; border-radius: 7px; color: var(--surface); background: var(--ink); transform: translateY(-150%); }
    .skip:focus { transform: none; }
    .app-bar { position: sticky; z-index: 10; top: 0; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(16px); }
    .app-bar-inner { display: flex; width: min(960px, 100%); min-height: 50px; align-items: center; gap: 9px; margin: 0 auto; padding: 0 max(20px, env(safe-area-inset-right)) 0 max(20px, env(safe-area-inset-left)); }
    .brand-mark { width: 22px; height: 22px; flex: 0 0 22px; overflow: visible; color: var(--rail-logo); }
    .brand-mark .rendezvous { fill: var(--ember); stroke: var(--surface); stroke-width: .65; }
    .camp-title { min-width: 0; flex: 1; overflow: hidden; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .readonly { display: inline-flex; min-height: 22px; align-items: center; padding: 0 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .04em; }
    .content { width: min(960px, 100%); margin: 0 auto; padding: 26px 20px calc(60px + env(safe-area-inset-bottom)); }
    .trigger-message { display: grid; max-width: 760px; grid-template-columns: 32px minmax(0, 1fr); align-items: flex-start; gap: 10px; }
    .trigger-avatar { display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid color-mix(in srgb, var(--brand) 36%, var(--line)); border-radius: 50%; color: var(--brand-ink); background: var(--surface-raised); font-size: 10px; font-weight: 700; }
    .trigger-avatar.is-agent { border-color: color-mix(in srgb, var(--identity-agent) 44%, var(--line)); color: var(--identity-agent); }
    .message-body { min-width: 0; max-width: 690px; }
    .message-meta { display: flex; min-height: 20px; align-items: baseline; gap: 7px; margin-bottom: 3px; }
    .message-meta strong { color: var(--brand-ink); font-size: 11.5px; font-weight: 700; }
    .message-meta strong.is-agent { color: var(--identity-agent); }
    .message-meta time { color: var(--faint); font: 500 9.5px/1.3 var(--mono); }
    .message-copy { max-width: 76ch; margin: 0; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.68; }
    .console { margin-top: 30px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--conversation-surface); }
    .console-head { --faint: var(--muted); display: flex; min-width: 0; min-height: 62px; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--line); background: var(--execution-running-surface); }
    .agent { display: flex; min-width: 0; align-items: center; gap: 9px; }
    .agent-avatar { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--identity-agent) 44%, var(--line)); border-radius: 50%; color: var(--identity-agent); background: var(--surface-raised); font-size: 10px; font-weight: 700; }
    .agent-copy { display: grid; min-width: 0; gap: 1px; }
    .agent-copy h1 { overflow: hidden; margin: 0; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .agent-copy p { overflow: hidden; margin: 0; color: var(--faint); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
    .connection { display: inline-flex; min-height: 28px; flex: 0 0 auto; align-items: center; gap: 7px; color: var(--muted); font-size: 9.5px; font-weight: 650; }
    .connection::before { width: 7px; height: 7px; border-radius: 50%; background: var(--info); box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 10%, transparent); content: ""; }
    .connection.is-terminal::before { background: var(--success); box-shadow: none; }
    .connection.is-reconnecting::before { background: var(--attention); box-shadow: none; }
    .timeline { position: relative; display: grid; gap: 0; margin: 0; padding: 14px 16px 22px; list-style: none; }
    .timeline::before { position: absolute; top: 27px; bottom: 37px; left: 22px; width: 1px; background: var(--line-strong); content: ""; }
    .run { position: relative; display: grid; min-width: 0; grid-template-columns: 14px minmax(0, 1fr); gap: 9px; padding: 0 0 14px; }
    .run:last-child { padding-bottom: 0; }
    .run-node { position: relative; z-index: 1; display: inline-grid; width: 13px; height: 13px; margin-top: 15px; place-items: center; border: 2px solid var(--line-strong); border-radius: 50%; background: var(--conversation-surface); }
    .run-node::after { width: 4px; height: 4px; border-radius: 50%; background: var(--line-strong); content: ""; }
    .run.status-running .run-node { border-color: var(--info); background: var(--info-soft); }
    .run.status-running .run-node::after { background: var(--info); box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 10%, transparent); }
    .run.status-waiting .run-node { border-color: var(--attention); background: var(--attention-soft); }
    .run.status-waiting .run-node::after { background: var(--attention); }
    .run.status-queued .run-node { border-color: var(--muted); background: var(--neutral-soft); }
    .run.status-succeeded .run-node { border-color: var(--success); background: var(--success-soft); }
    .run.status-succeeded .run-node::after { background: var(--success); }
    .run.status-failed .run-node { border-color: var(--danger); background: var(--danger-soft); }
    .run.status-failed .run-node::after { background: var(--danger); }
    .run.status-cancelled .run-node { border-color: var(--control-line); background: var(--surface-muted); }
    .run.status-cancelled .run-node::after { background: var(--muted); }
    .run-card { min-width: 0; padding: 0 11px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--conversation-surface); }
    .run.status-running .run-card { --faint: var(--muted); background: var(--execution-running-surface); }
    .run.is-focused .run-card { border-color: var(--control-line); box-shadow: 0 0 0 2px color-mix(in srgb, var(--control-line) 14%, transparent); }
    .run.is-focused.status-running .run-card { border-color: color-mix(in srgb, var(--info) 50%, var(--line)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--info) 7%, transparent); }
    .run-select { display: flex; width: calc(100% + 22px); min-height: 44px; align-items: center; justify-content: space-between; gap: 10px; margin: 0 -11px; padding: 8px 11px 7px; border: 0; border-radius: 8px 8px 5px 5px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
    .run-select:hover { background: var(--surface-hover); }
    .run-select:active { background: var(--surface-muted); }
    .run-title { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 5px 7px; }
    .run-title time { color: var(--ink); font: 700 10px/1.35 var(--mono); }
    .run-status { font-size: 9px; font-weight: 750; }
    .run-status.tone-info { color: var(--info); }
    .run-status.tone-attention { color: var(--attention); }
    .run-status.tone-success { color: var(--success); }
    .run-status.tone-danger { color: var(--danger); }
    .run-status.tone-neutral { color: var(--muted); }
    .current-badge { display: inline-flex; min-height: 18px; align-items: center; padding: 0 6px; border-radius: 999px; color: var(--info); background: var(--info-soft); font-size: 8.5px; font-weight: 800; }
    .selected-label { color: var(--brand-ink); font-size: 9px; font-weight: 700; }
    .run-disclosure { min-width: 0; margin: 1px 0 0; }
    .run-disclosure > summary { display: grid; min-width: 0; min-height: 34px; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; column-gap: 8px; padding: 5px 2px 7px 0; border-bottom: 1px solid var(--line); color: var(--muted); cursor: pointer; list-style: none; user-select: none; font-size: 11.5px; font-weight: 500; }
    .run-disclosure > summary::-webkit-details-marker, .tool-group > summary::-webkit-details-marker, .command-disclosure > summary::-webkit-details-marker, .file-disclosure > summary::-webkit-details-marker { display: none; }
    .run-disclosure > summary::marker, .tool-group > summary::marker, .command-disclosure > summary::marker, .file-disclosure > summary::marker { display: none; content: ""; }
    .run-disclosure > summary:hover { color: var(--ink); }
    .run-disclosure-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .disclosure-icon { display: grid; width: 24px; height: 24px; place-items: center; justify-self: end; border-radius: 5px; color: var(--faint); }
    .disclosure-icon svg, .group-disclosure svg, .command-disclosure-icon svg { display: block; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; transition: transform 120ms ease; }
    .run-disclosure:not([open]) .disclosure-icon svg { transform: rotate(-90deg); }
    .run-disclosure > summary:hover .disclosure-icon { color: var(--ink); background: var(--surface-hover); }
    .run-content { display: grid; gap: 14px; padding: 13px 0 6px; }
    .narration { max-width: 76ch; margin: 0; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; line-height: 1.68; }
    .tool-group { min-width: 0; }
    .tool-group > summary, .command-disclosure > summary, .file-disclosure > summary { list-style: none; cursor: pointer; user-select: none; }
    .tool-group-head { display: grid; min-width: 0; min-height: 28px; grid-template-columns: 16px minmax(0, 1fr) 16px 20px; align-items: center; column-gap: 8px; padding: 0 2px; border-radius: 6px; color: var(--muted); }
    .tool-group-head:hover { color: var(--ink); background: var(--surface-hover); }
    .group-icon, .tool-icon { display: inline-grid; width: 16px; height: 28px; place-items: center; color: var(--muted); }
    .group-icon svg, .tool-icon svg { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
    .group-icon circle { fill: currentColor; stroke: none; }
    .group-copy { display: flex; min-width: 0; min-height: 16px; align-items: center; overflow: hidden; }
    .group-line { display: flex; min-width: 0; align-items: center; gap: 5px; overflow: hidden; line-height: 16px; white-space: nowrap; }
    .group-line strong { flex: 0 0 auto; color: var(--ink); font-size: 10.5px; font-weight: 670; }
    .group-current { min-width: 0; overflow: hidden; color: var(--evidence-muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
    .group-separator { flex: 0 0 auto; color: var(--faint); }
    .state-dot { position: relative; display: grid; width: 16px; height: 28px; place-items: center; color: var(--muted); }
    .state-dot::before { width: 7px; height: 7px; border-radius: 50%; background: currentColor; content: ""; }
    .state-dot.status-running { color: var(--info); }
    .state-dot.status-running::after { position: absolute; width: 11px; height: 11px; border: 1px solid currentColor; border-radius: 50%; content: ""; opacity: .36; }
    .state-dot.status-completed { color: var(--success); }
    .state-dot.status-failed { color: var(--danger); }
    .state-dot.status-stopped { color: var(--muted); }
    .state-dot.status-failed::before, .state-dot.status-stopped::before { border-radius: 1px; transform: rotate(45deg); }
    .state-dot.status-waiting { color: var(--attention); }
    .state-dot.status-waiting::before { border: 1px solid currentColor; background: transparent; }
    .group-disclosure, .command-disclosure-icon { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 5px; color: var(--faint); }
    .tool-group[open] > summary .group-disclosure svg, .command-disclosure[open] > summary .command-disclosure-icon svg, .file-disclosure[open] > summary .command-disclosure-icon svg { transform: rotate(180deg); }
    .tool-group-head:hover .group-disclosure, .command-disclosure > summary:hover .command-disclosure-icon, .file-disclosure > summary:hover .command-disclosure-icon { color: var(--ink); background: var(--surface-muted); }
    .tool-list { display: grid; gap: 1px; margin: 3px 0 4px; padding: 4px 0; list-style: none; }
    .tool { min-width: 0; }
    .tool-row { display: grid; min-width: 0; min-height: 28px; grid-template-columns: 16px minmax(0, 1fr) 16px 20px; align-items: center; column-gap: 8px; padding: 0 2px; border-radius: 5px; color: var(--muted); }
    .command-disclosure > summary:hover, .command-disclosure[open] > summary, .file-disclosure > summary:hover, .file-disclosure[open] > summary { color: var(--ink); background: var(--surface-hover); }
    .tool-title { min-width: 0; overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
    .command-disclosure[open] .tool-title, .file-disclosure[open] .tool-title { color: inherit; }
    .tool-result { box-sizing: border-box; width: calc(100% - 54px); max-width: 100%; max-height: min(220px, 30vh); margin: 5px 52px 8px 2px; overflow: auto; overscroll-behavior: contain; padding: 8px 9px; border: 1px solid var(--evidence-line); border-radius: 5px; color: var(--evidence-muted); background: var(--shell-result-canvas); font: 10px/1.55 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-color: var(--control-line) transparent; scrollbar-width: thin; }
    .tool-result-state { display: flex; min-height: 44px; align-items: center; margin: 5px 52px 8px 2px; padding: 8px 9px; border: 1px solid var(--evidence-line); border-radius: 5px; color: var(--evidence-muted); background: var(--evidence-canvas); font-size: 10px; }
    .file-detail { display: flex; min-width: 0; align-items: baseline; gap: 8px; margin: 3px 0 8px; padding: 7px 9px; border: 1px solid var(--evidence-line); border-radius: 5px; color: var(--evidence-muted); background: var(--evidence-canvas); font: 10px/1.5 var(--mono); }
    .file-detail code { min-width: 0; flex: 1; overflow-wrap: anywhere; }
    .file-stats { display: flex; gap: 6px; font: 10px/1.35 var(--mono); white-space: nowrap; }
    .plus { color: var(--diff-add); }
    .minus { color: var(--diff-remove); }
    .empty { padding: 28px 12px; color: var(--muted); text-align: center; font-size: 11px; }
    .failure { display: grid; min-height: calc(100dvh - 50px); place-items: center; padding: 28px; text-align: center; }
    .failure div { max-width: 430px; }
    .failure strong { display: block; margin-bottom: 6px; font-size: 15px; }
    .failure p { margin: 0; color: var(--muted); font-size: 11px; }

    @media (max-width: 700px) {
      .app-bar-inner { padding-right: max(12px, env(safe-area-inset-right)); padding-left: max(12px, env(safe-area-inset-left)); }
      .content { padding: 19px max(12px, env(safe-area-inset-right)) calc(42px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
      .console { margin-top: 24px; border-right: 0; border-left: 0; border-radius: 0; }
      .console-head { min-height: 58px; padding: 10px 11px; }
      .agent-avatar { width: 32px; height: 32px; flex-basis: 32px; }
      .timeline { padding: 12px 9px 18px; }
      .timeline::before { left: 15px; }
      .run { grid-template-columns: 14px minmax(0, 1fr); gap: 6px; }
      .run-card { padding-right: 9px; padding-left: 9px; }
      .run-select { width: calc(100% + 18px); margin-right: -9px; margin-left: -9px; padding-right: 9px; padding-left: 9px; }
      .run-disclosure > summary, .tool-group-head, .tool-row { min-height: 44px; }
      .narration { font-size: 13px; }
      .tool-title { white-space: normal; overflow-wrap: anywhere; }
      .tool-result { width: 100%; margin-right: 0; font-size: 9.5px; }
      .tool-result-state { margin-right: 0; }
      .file-detail { align-items: flex-start; flex-direction: column; }
    }

    @media (max-width: 430px) {
      .selected-label { display: none; }
      .connection { font-size: 9px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
    }
  </style>
</head>
<body>
  <a class="skip" href="#console">跳到执行记录</a>
  <header class="app-bar">
    <div class="app-bar-inner">
      <svg class="brand-mark" data-brand-mark="horizon" data-brand-layout="separated" viewBox="0 0 24 24" role="img" aria-label="Rovai AI">
        <path d="M12 2 L13.16 7.3 L17.76 8.84 L13.16 10.38 L12 15.68 L10.84 10.38 L6.24 8.84 L10.84 7.3 Z" fill="currentColor" />
        <path d="M3 20.96 Q12 15.96 21 20.96" fill="none" stroke="currentColor" stroke-width="2.08" stroke-linecap="round" />
        <circle class="rendezvous" cx="12" cy="18.46" r="1.05" />
      </svg>
      <strong class="camp-title" id="camp-title">执行台</strong>
      <span class="readonly">只读</span>
    </div>
  </header>
  <main class="content" id="app">
    <div class="failure"><div><strong>正在读取执行记录</strong><p>请保持 Rovai 在本机运行。</p></div></div>
  </main>
  <script>
  (() => {
    'use strict'
    const app = document.getElementById('app')
    const campTitle = document.getElementById('camp-title')
    const match = location.pathname.match(/^\/execution\/([A-Za-z0-9_-]{1,200})$/)
    const runId = match ? match[1] : ''
    const params = new URLSearchParams(location.hash.slice(1))
    const token = params.get('t') || ''
    history.replaceState(null, '', location.pathname)
    const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    const runDisclosureState = new Map()
    const groupDisclosureState = new Map()
    const commandDisclosureState = new Map()
    let snapshot = null
    let selectedRunId = runId
    let stopped = false
    let streamState = 'live'

    const text = (tag, value, className) => {
      const node = document.createElement(tag)
      if (className) node.className = className
      node.textContent = value || ''
      return node
    }
    const svg = (paths, viewBox) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      node.setAttribute('viewBox', viewBox || '0 0 16 16')
      node.setAttribute('aria-hidden', 'true')
      paths.forEach((definition) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', definition[0])
        Object.entries(definition[1]).forEach((entry) => path.setAttribute(entry[0], entry[1]))
        node.append(path)
      })
      return node
    }
    const chevron = (className) => {
      const node = text('span', '', className)
      node.append(svg([['path', { d: 'm4.75 6.25 3.25 3.5 3.25-3.5' }]]))
      return node
    }
    const toolIcon = (kind) => {
      const node = text('span', '', 'tool-icon')
      const icons = {
        terminal: [['rect', { x: '1.75', y: '2.25', width: '12.5', height: '11.5', rx: '2' }], ['path', { d: 'M4.25 6 6.1 7.8 4.25 9.6M8 10h3.2' }]],
        file: [['path', { d: 'M4 1.75h5.1L12.5 5v9.25H4z' }], ['path', { d: 'M9 1.9V5h3.2M6 8h4.4M6 10.5h3.3' }]],
        web: [['circle', { cx: '8', cy: '8', r: '6.1' }], ['path', { d: 'M1.9 8h12.2M8 1.9c1.7 1.7 2.55 3.73 2.55 6.1S9.7 12.4 8 14.1M8 1.9C6.3 3.6 5.45 5.63 5.45 8S6.3 12.4 8 14.1' }]],
        rovai: [['path', { d: 'M8 1.5 9 6l3.9 1.35L9 8.7l-1 4.5-1-4.5-3.9-1.35L7 6z' }]],
        runtime: [['circle', { cx: '8', cy: '8', r: '5.7' }], ['path', { d: 'M8 4.6v3.8l2.5 1.45' }]],
        tool: [['path', { d: 'm8 1.8 1.65 4.55L14.2 8l-4.55 1.65L8 14.2 6.35 9.65 1.8 8l4.55-1.65z' }]]
      }
      node.append(svg(icons[kind] || icons.tool))
      return node
    }
    const groupIcon = () => {
      const node = text('span', '', 'group-icon')
      node.append(svg([['circle', { cx: '2.25', cy: '4', r: '.65' }], ['circle', { cx: '2.25', cy: '8', r: '.65' }], ['circle', { cx: '2.25', cy: '12', r: '.65' }], ['path', { d: 'M5 4h8M5 8h8M5 12h8' }]]))
      return node
    }
    const stateDot = (status, label) => {
      const node = text('span', '', 'state-dot status-' + status)
      node.setAttribute('role', 'img')
      node.setAttribute('aria-label', label || status)
      return node
    }
    const fail = (title, detail) => {
      stopped = true
      app.replaceChildren()
      const shell = text('div', '', 'failure')
      const box = document.createElement('div')
      box.append(text('strong', title), text('p', detail))
      shell.append(box)
      app.append(shell)
    }
    const status = (run) => {
      const map = { queued: ['已排队', 'tone-neutral'], running: ['执行中', 'tone-info'], waiting: ['等待处理', 'tone-attention'], succeeded: ['已完成', 'tone-success'], failed: ['执行失败', 'tone-danger'], cancelled: ['已停止', 'tone-neutral'] }
      return map[run.status] || [run.status, 'tone-neutral']
    }
    const clock = (value) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
    }
    const nonTerminal = (run) => run.status === 'queued' || run.status === 'running' || run.status === 'waiting'
    const timeRange = (run) => clock(run.startedAt || run.createdAt) + '–' + (nonTerminal(run) ? '现在' : clock(run.endedAt || run.createdAt))
    const durationLabel = (run) => {
      if (nonTerminal(run)) return '处理过程'
      const started = new Date(run.startedAt || run.createdAt).getTime()
      const ended = new Date(run.endedAt || run.createdAt).getTime()
      if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return '处理过程'
      const seconds = Math.max(1, Math.round((ended - started) / 1000))
      if (seconds < 60) return '处理过程 · ' + seconds + '秒'
      const minutes = Math.floor(seconds / 60)
      const remainder = seconds % 60
      return '处理过程 · ' + minutes + '分' + (remainder ? remainder + '秒' : '')
    }
    const disclosure = (className, state, key, defaultOpen) => {
      const node = document.createElement('details')
      node.className = className
      node.open = state.has(key) ? state.get(key) : defaultOpen
      node.addEventListener('toggle', () => state.set(key, node.open))
      node.addEventListener('keydown', (event) => {
        if (event.target !== node.firstElementChild || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        node.open = !node.open
      })
      return node
    }
    const fileName = (path) => path.split('/').filter(Boolean).pop() || path
    const setSource = (run) => {
      selectedRunId = run.id
      document.querySelectorAll('.run').forEach((node) => {
        const selected = node.dataset.runId === run.id
        node.classList.toggle('is-focused', selected)
        if (selected) node.setAttribute('aria-current', 'step')
        else node.removeAttribute('aria-current')
        node.querySelector('.run-select')?.setAttribute('aria-pressed', String(selected))
        const label = node.querySelector('.selected-label')
        if (label) label.textContent = selected ? '当前消息' : '查看消息'
      })
      const agentAuthored = run.trigger.authorKind === 'agent'
      const authorName = agentAuthored ? (run.trigger.authorDisplayName || '队员') : '你'
      const avatar = document.getElementById('source-avatar')
      const meta = document.getElementById('source-meta')
      const copy = document.getElementById('source-copy')
      if (avatar) {
        avatar.textContent = Array.from(authorName.trim())[0] || (agentAuthored ? '队' : '你')
        avatar.classList.toggle('is-agent', agentAuthored)
      }
      if (meta) meta.replaceChildren(text('strong', authorName, agentAuthored ? 'is-agent' : ''), text('time', clock(run.trigger.createdAt || run.createdAt)))
      if (copy) copy.textContent = run.trigger.summary || '这次执行没有可显示的触发消息摘要。'
    }
    const renderCommand = (activity, run, groupIndex, activityIndex, defaultOpen) => {
      const key = run.id + ':group:' + groupIndex + ':command:' + activityIndex
      const item = text('li', '', 'tool')
      const details = disclosure('command-disclosure', commandDisclosureState, key, defaultOpen)
      const summary = text('summary', '', 'tool-row')
      summary.append(toolIcon(activity.iconKind), text('span', activity.title || '执行记录', 'tool-title'), stateDot(activity.status || 'recorded', activity.statusLabel || ''), chevron('command-disclosure-icon'))
      details.append(summary)
      if (activity.result) {
        const result = text('pre', activity.result, 'tool-result')
        result.tabIndex = 0
        result.setAttribute('role', 'region')
        result.setAttribute('aria-label', (activity.title || '命令') + '的公开结果')
        details.append(result)
      } else {
        details.append(text('div', activity.status === 'running' ? '正在执行' : '暂无公开结果', 'tool-result-state'))
      }
      item.append(details)
      return item
    }
    const renderFile = (file, run, groupIndex, activityIndex, fileIndex) => {
      const key = run.id + ':group:' + groupIndex + ':activity:' + activityIndex + ':file:' + fileIndex
      const item = text('li', '', 'tool')
      const details = disclosure('file-disclosure', commandDisclosureState, key, false)
      const summary = text('summary', '', 'tool-row')
      summary.append(toolIcon('file'), text('span', '修改 ' + fileName(file.path), 'tool-title'), stateDot('completed', '文件修改已记录'), chevron('command-disclosure-icon'))
      details.append(summary)
      const detail = text('div', '', 'file-detail')
      detail.append(text('code', file.path))
      const stats = text('span', '', 'file-stats')
      if (Number.isFinite(file.additions)) stats.append(text('span', '+' + file.additions, 'plus'))
      if (Number.isFinite(file.deletions)) stats.append(text('span', '−' + file.deletions, 'minus'))
      detail.append(stats)
      details.append(detail)
      item.append(details)
      return item
    }
    const renderGroup = (item, run, groupIndex, defaultOpen) => {
      const key = run.id + ':group:' + groupIndex
      const details = disclosure('tool-group', groupDisclosureState, key, defaultOpen)
      const summary = text('summary', '', 'tool-group-head')
      summary.setAttribute('aria-label', item.accessibleLabel || item.primary || '连续操作')
      const copy = text('span', '', 'group-copy')
      const line = text('span', '', 'group-line')
      line.append(text('strong', item.primary || '执行记录'))
      if (item.currentTitle) line.append(text('span', '·', 'group-separator'), text('span', item.currentTitle, 'group-current'))
      copy.append(line)
      summary.append(groupIcon(), copy, stateDot(item.status || 'recorded', item.statusLabel || ''), chevron('group-disclosure'))
      details.append(summary)
      const list = text('ul', '', 'tool-list')
      ;(item.activities || []).forEach((activity, activityIndex) => {
        if (Array.isArray(activity.files) && activity.files.length) activity.files.forEach((file, fileIndex) => list.append(renderFile(file, run, groupIndex, activityIndex, fileIndex)))
        else list.append(renderCommand(activity, run, groupIndex, activityIndex, defaultOpen && activityIndex === 0))
      })
      details.append(list)
      return details
    }
    const setConnection = (state) => {
      streamState = state
      const node = document.getElementById('connection')
      if (!node || !snapshot) return
      node.className = 'connection'
      if (snapshot.terminal) {
        node.classList.add('is-terminal')
        node.textContent = '执行已结束'
      } else if (state === 'reconnecting') {
        node.classList.add('is-reconnecting')
        node.textContent = '正在重连'
      } else node.textContent = '实时更新'
    }
    const render = () => {
      if (!snapshot) return
      campTitle.textContent = snapshot.camp.title || '执行台'
      app.replaceChildren()
      const source = text('section', '', 'trigger-message')
      source.setAttribute('aria-label', '本次执行的触发消息')
      source.setAttribute('aria-live', 'polite')
      const triggerAvatar = text('span', '', 'trigger-avatar')
      triggerAvatar.id = 'source-avatar'
      triggerAvatar.setAttribute('aria-hidden', 'true')
      source.append(triggerAvatar)
      const message = text('div', '', 'message-body')
      const meta = text('div', '', 'message-meta')
      meta.id = 'source-meta'
      const copy = text('p', '', 'message-copy')
      copy.id = 'source-copy'
      message.append(meta, copy)
      source.append(message)
      app.append(source)

      const consoleBox = text('section', '', 'console')
      consoleBox.id = 'console'
      consoleBox.setAttribute('aria-labelledby', 'execution-title')
      const head = text('header', '', 'console-head')
      const agent = text('div', '', 'agent')
      const agentAvatar = text('span', (snapshot.agent.displayName || '队').slice(0, 1), 'agent-avatar')
      agentAvatar.setAttribute('aria-hidden', 'true')
      agent.append(agentAvatar)
      const agentCopy = text('div', '', 'agent-copy')
      const agentTitle = text('h1', snapshot.agent.displayName || '队员', '')
      agentTitle.id = 'execution-title'
      const executing = snapshot.runs.some((run) => nonTerminal(run))
      agentCopy.append(agentTitle, text('p', '共 ' + snapshot.runs.length + ' 次执行' + (executing ? ' · 当前正在执行' : '')))
      agent.append(agentCopy)
      const connection = text('span', '', 'connection')
      connection.id = 'connection'
      connection.setAttribute('role', 'status')
      head.append(agent, connection)
      consoleBox.append(head)

      const list = text('ol', '', 'timeline')
      if (!snapshot.runs.length) list.append(text('li', '没有可显示的执行记录。', 'empty'))
      snapshot.runs.forEach((run) => {
        const focused = run.id === selectedRunId
        const li = text('li', '', 'run status-' + run.status + (focused ? ' is-focused' : ''))
        li.dataset.runId = run.id
        if (focused) li.setAttribute('aria-current', 'step')
        li.append(text('span', '', 'run-node'))
        const card = text('article', '', 'run-card')
        const button = text('button', '', 'run-select')
        button.type = 'button'
        button.setAttribute('aria-label', '查看 ' + timeRange(run) + ' 这次执行的触发消息')
        button.setAttribute('aria-pressed', String(focused))
        const title = text('span', '', 'run-title')
        title.append(text('time', timeRange(run)))
        const runState = status(run)
        title.append(text('span', runState[0], 'run-status ' + runState[1]))
        if (run.id === snapshot.focusRunId && nonTerminal(run)) title.append(text('span', '当前执行', 'current-badge'))
        button.append(title, text('span', focused ? '当前消息' : '查看消息', 'selected-label'))
        button.addEventListener('click', () => setSource(run))
        card.append(button)

        const runDetails = disclosure('run-disclosure', runDisclosureState, run.id, run.id === snapshot.focusRunId)
        const runSummary = text('summary', '', '')
        runSummary.setAttribute('aria-label', timeRange(run) + ' 这次 AgentRun 的执行过程')
        runSummary.append(text('span', durationLabel(run), 'run-disclosure-label'), chevron('disclosure-icon'))
        runDetails.append(runSummary)
        const body = text('div', '', 'run-content')
        const groups = (run.items || []).filter((item) => item.kind === 'activityGroup')
        const trailingGroup = groups[groups.length - 1]
        let groupIndex = 0
        ;(run.items || []).forEach((item) => {
          if (item.kind === 'narration') body.append(text('p', item.body, 'narration'))
          else if (item.kind === 'activityGroup') {
            body.append(renderGroup(item, run, groupIndex, run.id === snapshot.focusRunId && item === trailingGroup))
            groupIndex += 1
          }
        })
        if (!(run.items || []).length) body.append(text('p', '暂无公开执行记录。', 'narration'))
        runDetails.append(body)
        card.append(runDetails)
        li.append(card)
        list.append(li)
      })
      consoleBox.append(list)
      app.append(consoleBox)
      const selected = snapshot.runs.find((run) => run.id === selectedRunId) || snapshot.runs.find((run) => run.id === snapshot.focusRunId) || snapshot.runs[0]
      if (selected) setSource(selected)
      setConnection(streamState)
    }
    const acceptSnapshot = (value) => {
      if (!value || value.schemaVersion !== 1 || value.focusRunId !== runId || !Array.isArray(value.runs)) throw new Error('invalid_projection')
      snapshot = value
      if (!snapshot.runs.some((run) => run.id === selectedRunId)) selectedRunId = runId
      render()
    }
    const readSnapshot = async () => {
      const response = await fetch('/api/execution/' + encodeURIComponent(runId) + '/snapshot', { headers: auth, cache: 'no-store' })
      if (response.status === 401 || response.status === 410) throw new Error('invalid_token')
      if (!response.ok) throw new Error('unavailable')
      acceptSnapshot(await response.json())
    }
    const stream = async () => {
      if (stopped || snapshot?.terminal) return
      const response = await fetch('/api/execution/' + encodeURIComponent(runId) + '/events', { headers: { ...auth, Accept: 'text/event-stream' }, cache: 'no-store' })
      if (response.status === 401 || response.status === 410) throw new Error('invalid_token')
      if (!response.ok || !response.body) throw new Error('unavailable')
      setConnection('live')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!stopped) {
        const part = await reader.read()
        if (part.done) throw new Error('disconnected')
        buffer += decoder.decode(part.value, { stream: true })
        let cut
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
          if (!data) continue
          const message = JSON.parse(data)
          if (message.type === 'snapshot') acceptSnapshot(message.snapshot)
          if (message.type === 'terminal') {
            acceptSnapshot(message.snapshot)
            stopped = true
            return
          }
          if (message.type === 'invalidated') throw new Error('invalid_token')
        }
      }
    }
    const follow = async () => {
      while (!stopped && !snapshot?.terminal) {
        try {
          await stream()
        } catch (error) {
          if (error.message === 'invalid_token') throw error
          if (!stopped) {
            setConnection('reconnecting')
            await new Promise((resolve) => setTimeout(resolve, 1200))
          }
        }
      }
    }
    if (!runId || !token) {
      fail('此执行台链接已失效', '请回到飞书执行卡重新打开。')
      return
    }
    readSnapshot().then(() => follow()).catch((error) => {
      if (error.message === 'invalid_token') fail('此执行台链接已失效', '请回到飞书执行卡重新打开。')
      else fail('暂时无法读取执行记录', '确认手机或电脑与 Rovai 位于同一局域网后重试。')
    })
  })()
  </script>
</body>
</html>`
