# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop

## Users

Rovai AI serves developers who coordinate coding agents on their desktop. They need to assign work,
inspect what each agent did, intervene when approval or recovery is required, and keep collaboration
state understandable across long-running projects.

## Product Purpose

Rovai AI is a desktop workspace for long-lived agent teams. It organizes members, Camps, tasks,
execution, approvals, evidence, recovery and collaborative memory while driving coding-agent
Runtimes already installed on the user's machine. Success means the user can understand and control
collaborative agent work without surrendering ownership of the workspace, Runtime configuration or
credentials.

## Positioning

The product combines durable collaboration state with Runtime-native execution and explicit
evidence boundaries. It does not replace supported coding-agent products with a hosted proxy; it
coordinates them while preserving which facts came from Rovai Core and which came from each Runtime.

## Operating Context

- A desktop Electron application operates alongside local Git workspaces and coding-agent CLIs; platform-specific
  support and qualification remain explicit for macOS and Windows rather than being inferred from a shared UI.
- Users move between Camps, members, memory, settings, approvals, diagnostics and execution detail.
- Runtime availability, model capabilities and usage reporting vary by installed product and version.
- Monitoring is a compact Usage read surface: users compare recent Runtime-reported Token, Cache,
  attributable Cost and Coverage without exposing prompts, completions, tool output or credentials.

## Capabilities and Constraints

- Supported product language includes “Camp”, “队员”, “记忆”, “Agent 运行时” and “快速对话”.
- SQLite-backed Core facts are authoritative; Renderer pages consume typed, read-only projections.
- Runtime Usage is sparse and source-qualified. Missing fields remain unknown and never become zero.
- Each Monitoring schema begins at a persistent clean-break collection boundary; older Core runs are
  retained but are not backfilled or included in current Usage denominators.
- Runtime-reported cost, public-price estimates and Provider billing buckets remain distinct grains.
- User workspaces, Runtime-native configuration and credentials remain user-owned and local.
- Rovai AI publishes versioned public releases; compatibility labels describe Rovai's verified evidence,
  not upstream support promises.

## Brand Commitments

The product name is “Rovai AI” in application UI and “Rovai-ai” where existing package/repository
naming requires it. Copy is calm, direct and evidence-first. Uncertainty, partial coverage and the
next available action are stated plainly rather than hidden behind optimistic status language.

## Evidence on Hand

- Product scope and current claims: `README.md`.
- Durable visual system and brand mark: `DESIGN.md` and `docs/ui/`.
- Runtime compatibility evidence: `docs/runtime-compatibility.md`.
- Current monitoring scope, field semantics and acceptance: `docs/versions/v0.96/`,
  `docs/contracts/runtime-monitoring-v1.md` and `docs/research/runtime-monitoring/README.md`.
- The supplied monitoring HTML is a prototype for information coverage; its sample values are not
  production evidence and must not ship as fallback data.

## Product Principles

1. Preserve provenance: every operational claim names its authority and quality.
2. Make uncertainty useful: unknown and partial states show coverage and a concrete explanation.
3. Keep ownership boundaries explicit: coordination must not silently take over workspaces or credentials.
4. Prefer durable, inspectable state over transient inference.
5. Keep dense operational surfaces calm, navigable and honest.

## Accessibility & Inclusion

Primary desktop surfaces support keyboard operation, visible focus, screen-reader labels, reduced
motion, both production themes, 200% zoom and the minimum `1040×700` window without page-level
horizontal overflow. State is never communicated by color alone.
