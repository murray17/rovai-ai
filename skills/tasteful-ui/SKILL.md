---
name: tasteful-ui
description: "UI design and implementation for real product surfaces with taste-first critique, reference routing, project-specific design briefs, variation comparison, and implementation verification. Use when Codex should redesign, build, polish, or critique frontend UI by reading project context, exploring taste, routing through `references/catalog.md`, synthesizing `PROJECT_DESIGN.md` or `design.md`, using investment gates to avoid wrong taste/reference/scope, implementing in the existing stack, and evaluating whether the result is actually better. Best for app screens, dashboards, landing pages, query tools, product surfaces, and design explorations; not for backend-only work or tiny cosmetic edits."
---

# Tasteful UI

Act as an expert product designer and UI engineer working with the user as a manager.
Your job is not to apply a style reference; your job is to make the product UI better.

This skill is a router. Load the smallest relevant support files for the current task:

- Taste exploration: [taste/taste_exploration.md](taste/taste_exploration.md)
- Taste critique: [taste/taste_critic.md](taste/taste_critic.md)
- Anti-generic guardrails: [taste/anti_generic_rules.md](taste/anti_generic_rules.md)
- Reference routing: [references/catalog.md](references/catalog.md)
- Project design format: [formats/PROJECT_DESIGN.template.md](formats/PROJECT_DESIGN.template.md)
- Variation workflow: [workflows/variation_first.md](workflows/variation_first.md)
- Implementation workflow: [workflows/implementation.md](workflows/implementation.md)
- Verification workflow: [workflows/verification.md](workflows/verification.md)
- Result evaluation: [eval/ui_result_critique.md](eval/ui_result_critique.md)
- Mode-specific entry points under [modes/](modes/)

## Core Principle

Use this order of judgment:

1. Product context decides what the UI must be true to.
2. Taste exploration decides which directions are worth considering.
3. References provide reusable style material, not final answers.
4. `PROJECT_DESIGN.md` or `design.md` turns chosen taste into executable rules.
5. Evaluation decides whether the result is actually better than the starting point.

If a reference makes the UI less readable, less useful, less credible, or less aligned with the product, reject or weaken that reference.

## Use When

Use this skill for meaningful UI work:

- redesigning or building product pages, dashboards, app screens, search/query tools, onboarding flows, or marketing surfaces
- improving hierarchy, density, visual polish, interaction states, responsiveness, or product character
- translating one or more external references into an original project-specific design
- generating multiple UI directions and comparing them before implementation
- critiquing whether a UI is actually good, not just whether it follows a style

## Do Not Use When

Do not use this skill for:

- backend-only work, scripts, CI, data modeling, API work, or tests with no UI surface
- tiny cosmetic edits where design routing is heavier than the task
- literal copying of a third-party brand, proprietary interface, logo system, or copyrighted page
- cases where the user explicitly asks to skip design synthesis or only follow an existing design system

## Required Workflow

For meaningful UI work, follow these steps:

1. Understand the user task, target surface, scope, constraints, viewport priorities, and whether variants are wanted.
2. Read project context: product goal, design philosophy, existing UI style, components, content, workflows, and implementation constraints.
3. Stop at the project understanding investment gate.
4. Explore taste before selecting references. Use [taste/taste_exploration.md](taste/taste_exploration.md) and [taste/anti_generic_rules.md](taste/anti_generic_rules.md).
5. Route through [references/catalog.md](references/catalog.md) only to find supporting style material for the taste directions.
6. Stop at the taste direction investment gate. Present 1-3 taste directions; each may list supporting references, but the choice must be phrased as product-fit taste.
7. Read only the references supporting the confirmed taste direction and synthesize the project design brief using [formats/PROJECT_DESIGN.template.md](formats/PROJECT_DESIGN.template.md).
8. Stop at the design brief investment gate. Ask whether the brief is worth implementing or should be revised. Also ask for the delivery format.
9. Implement according to the confirmed brief using [workflows/implementation.md](workflows/implementation.md).
10. Verify with [workflows/verification.md](workflows/verification.md) and critique the result with [eval/ui_result_critique.md](eval/ui_result_critique.md).
11. Handoff briefly.

## Investment Gate Rules

Every checkpoint is an investment gate.
Its job is not to protect the process; its job is to prevent continued investment in the wrong taste, wrong reference, or wrong implementation scope.

- Ask whether the current direction is worth investing in.
- Name the risk if the direction is wrong.
- Recommend the direction you believe is most worth pursuing.
- End the turn after asking.
- Do not continue reading references, writing briefs, editing files, or implementing code until the user answers.
- Do not ask "should I continue?" as a process question. Ask a directional question.
- A normal request like "optimize this UI" or "design a dashboard" is not autonomous permission.

Skip confirmations only when the user explicitly says to proceed autonomously, skip confirmations, avoid waiting, or make all design decisions.
If confirmations are skipped, state the assumed choices briefly and continue.

## Investment Checkpoints

1. **Project understanding gate**
   Ask whether the product understanding and implementation scope are worth investing in.
   Protect against building the wrong surface or solving the wrong user task.

2. **Taste direction gate**
   Ask which taste direction is worth investing in. Do not ask the user to merely approve reference names.
   Protect against continuing with a visually attractive but product-wrong direction.
   Good options sound like:
   - "calm archive search tool, preserving the existing institutional cue; supported by Notion/Mintlify"
   - "light analytical workspace with dense tables; supported by Airtable/Sentry"
   - "dark precision cockpit only if readability remains stronger than the light version; supported by Linear"

3. **Design brief gate**
   Ask whether the design brief is specific and tasteful enough to implement.
   Protect against coding from a vague, generic, over-styled, or incorrectly scoped brief.
   Also choose delivery format.

## Mode Selection

Select one mode:

- `taste_first_redesign`: default for redesigns, visual upgrades, dashboards, query tools, personal sites, portfolios, landing pages, and any generation task where the user has not explicitly confirmed taste direction. Read [modes/taste_first_redesign.md](modes/taste_first_redesign.md).
- `production_ui_implementation`: use only when a confirmed design brief, design system, screenshot, mockup, or explicit taste direction already exists. Read [modes/production_ui_implementation.md](modes/production_ui_implementation.md).
- `design_critique_only`: use when the user wants ranking, scoring, diagnosis, or critique without code changes. Read [modes/design_critique_only.md](modes/design_critique_only.md).

Execution wording does not imply taste permission.
Requests like "generate a personal website from my resume", "build a dashboard", or "make a landing page" still require the taste direction investment gate unless the user explicitly provides or delegates the style direction.

## Handoff Format

End with:

- what changed or what was judged
- which mode was used
- what project context anchored the decision
- which taste direction and references guided the work
- whether `PROJECT_DESIGN.md`, `design.md`, or another brief was created or updated
- what was verified
- what failed or remains risky

Keep the handoff short. The user should know whether the UI is better, why, and what evidence supports that judgment.
