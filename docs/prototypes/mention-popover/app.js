(() => {
  const members = {
    fox: {
      name: "小狐狸",
      glyph: "狐",
      role: "游学者 · 前端体验设计",
      presence: "在队",
      runtime: "Antigravity · 可用",
      responsibility: "负责理解需求、梳理界面体验、处理交互细节，并将明确方案落实为可运行的前端改动。",
      principle: "先读真实产品约束，再用尽量少的视觉重量解决问题。",
      traits: ["好奇", "灵活", "勤勉"],
      portrait: "assets/role-card-fox-4x5.png",
      portraitPosition: "51% 34%",
      portraitStart: "#f4dfcf",
      portraitEnd: "#dce9e3",
      portraitInk: "#98533e"
    },
    beaver: {
      name: "小河狸",
      glyph: "河",
      role: "鉴定士 · 工程评审",
      presence: "在队",
      runtime: "Codex CLI · 可用",
      responsibility: "负责检查事实、结构、边界、风险与实现是否一致，并给出明确、可执行的评审结论。",
      principle: "优先复用现有组件与语义，不为视觉效果引入第二套状态。",
      traits: ["可靠", "务实", "重视证据"],
      portraitStart: "#e4eee8",
      portraitEnd: "#d5e6ec",
      portraitInk: "#39777a"
    },
    rabbit: {
      name: "小兔",
      glyph: "兔",
      role: "绘图师 · UI/UX 设计",
      presence: "在队",
      runtime: "Antigravity · 可用",
      responsibility: "负责 UI、UX、视觉设计和前端实现，把复杂功能组织成清晰、顺手且一致的界面体验。",
      principle: "先确认用户任务，再决定信息层级与视觉节奏。",
      traits: ["敏捷", "温和", "结构化"],
      portraitStart: "#eee7f4",
      portraitEnd: "#dce6ef",
      portraitInk: "#74628f"
    },
    owl: {
      name: "咕咕",
      glyph: "咕",
      role: "巡夜人 · 测试与验证",
      presence: "暂离",
      runtime: "Codex CLI · 待确认",
      responsibility: "负责设计和执行测试、复现问题、检查边界与失败路径，并通过可重复结果确认功能可靠。",
      principle: "对不确定状态保持明确表达，对关键结论保留验证证据。",
      traits: ["谨慎", "直接", "善于复盘"],
      portraitStart: "#f2e8d5",
      portraitEnd: "#e2e8dd",
      portraitInk: "#9a6a32"
    }
  };

  const popover = document.getElementById("member-popover");
  const popoverContent = document.getElementById("popover-content");
  const timeline = document.querySelector(".timeline-scroll");
  const workspace = document.querySelector(".workspace");
  const inspectorToggle = document.querySelector(".inspector-toggle");
  const composer = document.getElementById("composer");
  const toast = document.getElementById("toast");
  let activeTrigger = null;
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function portraitMarkup(member) {
    if (member.portrait) {
      return `<img class="popover-portrait" src="${member.portrait}" alt="${escapeHtml(member.name)}的 4:5 角色卡" style="object-position:${member.portraitPosition}" draggable="false">`;
    }

    return `<div class="fallback-portrait" role="img" aria-label="${escapeHtml(member.name)}的角色半身图" style="--portrait-start:${member.portraitStart};--portrait-end:${member.portraitEnd};--portrait-ink:${member.portraitInk}">${escapeHtml(member.glyph)}</div>`;
  }

  function memberMarkup(member) {
    const traits = member.traits
      .map((trait) => `<span>${escapeHtml(trait)}</span>`)
      .join("");
    const awayClass = member.presence === "暂离" ? "away" : "";

    return `
      <div class="popover-side-shell">
        <div class="popover-side-media">
          ${portraitMarkup(member)}
          <span class="portrait-label">PORTRAIT</span>
        </div>
        <div class="popover-side-copy">
          <header class="popover-header">
            <div class="popover-title">
              <h2>${escapeHtml(member.name)}</h2>
              <p>${escapeHtml(member.role)}</p>
            </div>
          </header>
          <div class="popover-status">
            <span class="${awayClass}"><i></i>${escapeHtml(member.presence)}</span>
            <span><i></i>${escapeHtml(member.runtime)}</span>
          </div>
          <dl class="popover-body">
            <div class="popover-field">
              <dt>专业职责</dt>
              <dd>${escapeHtml(member.responsibility)}</dd>
            </div>
            <div class="popover-field">
              <dt>工作准则</dt>
              <dd>${escapeHtml(member.principle)}</dd>
            </div>
            <div class="popover-field">
              <dt>性格底色</dt>
              <dd><div class="trait-list">${traits}</div></dd>
            </div>
          </dl>
        </div>
      </div>`;
  }

  function groupMarkup(context) {
    const historical = context === "history";
    const rows = Object.values(members)
      .map((member) => `
        <div class="group-member">
          <i>${escapeHtml(member.glyph)}</i>
          <strong>${escapeHtml(member.name)}</strong>
          <span>${escapeHtml(member.presence)}</span>
        </div>`)
      .join("");

    return `
      <div class="group-popover">
        <header class="popover-header">
          <div class="group-icon" aria-hidden="true">@</div>
          <div class="popover-title">
            <h2>所有成员</h2>
            <p>广播 Mention</p>
          </div>
        </header>
        <div class="popover-status">
          <span><i></i>${historical ? "发送时已冻结 4 位收件人" : "当前 4 位在队队员"}</span>
        </div>
        <p class="group-summary">${historical
          ? "历史消息展示发送接受时冻结的收件人范围，之后的加入或离队不会改写它。"
          : "发送接受时会冻结当前实际寻址的队员集合。"}</p>
        <div class="group-members">${rows}</div>
      </div>`;
  }

  function closePopover(returnFocus = false) {
    if (!activeTrigger && popover.hidden) return;
    const previousTrigger = activeTrigger;
    if (previousTrigger) previousTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = null;
    popover.classList.remove("is-open");
    popover.hidden = true;
    if (returnFocus && previousTrigger) previousTrigger.focus({ preventScroll: true });
  }

  function positionPopover() {
    if (!activeTrigger || popover.hidden) return;

    const triggerRect = activeTrigger.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 10;
    const margin = 8;
    const roomAbove = triggerRect.top - margin;
    const roomBelow = viewportHeight - triggerRect.bottom - margin;
    const placeBelow = roomBelow >= height + gap || roomBelow > roomAbove;
    let top = placeBelow ? triggerRect.bottom + gap : triggerRect.top - height - gap;
    let left = triggerRect.left + triggerRect.width / 2 - width / 2;

    top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.setProperty(
      "--arrow-x",
      `${Math.max(16, Math.min(width - 16, Math.round(triggerRect.left + triggerRect.width / 2 - left)))}px`
    );
    popover.dataset.placement = placeBelow ? "bottom" : "top";
  }

  function openPopover(trigger, focusPanel = false) {
    if (activeTrigger === trigger && !popover.hidden) {
      closePopover(true);
      return;
    }

    closePopover(false);
    activeTrigger = trigger;
    const member = trigger.dataset.member ? members[trigger.dataset.member] : null;
    popoverContent.innerHTML = member
      ? memberMarkup(member)
      : groupMarkup(trigger.dataset.context || "history");
    popover.setAttribute("aria-label", member ? `${member.name}的基础信息` : "所有成员范围");
    popover.dataset.contentKind = member ? "member" : "group";
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");

    requestAnimationFrame(() => {
      positionPopover();
      popover.classList.add("is-open");
      if (focusPanel) popover.focus({ preventScroll: true });
    });
  }

  document.querySelectorAll(".mention").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (window.getSelection()?.toString()) return;
      openPopover(trigger, false);
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        openPopover(trigger, true);
      }
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || activeTrigger?.contains(event.target)) return;
    closePopover(false);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      event.preventDefault();
      closePopover(true);
    }
  });

  window.addEventListener("resize", positionPopover);
  timeline.addEventListener("scroll", positionPopover, { passive: true });

  inspectorToggle.addEventListener("click", () => {
    const closed = workspace.classList.toggle("inspector-closed");
    inspectorToggle.setAttribute("aria-pressed", String(!closed));
    requestAnimationFrame(positionPopover);
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  });

  const params = new URL(window.location.href).searchParams;
  const preview = params.get("preview");
  if (preview) {
    requestAnimationFrame(() => {
      const trigger = document.querySelector(`.mention[data-member="${CSS.escape(preview)}"][data-context="history"]`);
      if (trigger) openPopover(trigger, false);
    });
  }
})();
