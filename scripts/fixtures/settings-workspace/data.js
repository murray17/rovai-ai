// In-memory UI fixtures only. These values never enter the production bridge or daily data.
import { BUILTIN_MEMBER_PRESETS } from '@renderer/member-presets';
import { VISIBLE_PRODUCT_RUNTIMES } from '@renderer/runtime-products';
import { DEFAULT_APPEARANCE } from '@shared/appearance';
export const clone = x => structuredClone(x);
export const now = '2026-09-08T11:00:00Z';
export const agents = BUILTIN_MEMBER_PRESETS.map((p, i) => ({ ...clone(p), agentId: 'sample-' + p.role, presence: 'present', memberOrder: i, removedAt: null, accent: null, version: 1, createdAt: now, updatedAt: now, defaultCapabilities: [], runtimeReadiness: { status: 'ready', blockers: [] }, runtimeConfiguration: { adapterKind: i === 1 ? 'claude-code-cli' : 'codex-cli', model: { mode: 'runtime_default' }, permissions: { schemaVersion: 1, adapterKind: i === 1 ? 'claude-code-cli' : 'codex-cli', values: {} } } }));
const extraNames = ['阿森', '林舟', '小满', '时雨', '青禾', '白露', '星野', '可乐', '木木', '山月', '蓝桉', '南星', '月白', '知夏', '拾柒', '阿序', '图南', '云初', '若川', '青屿'];
const extraRoles = ['工程师', '产品经理', '研究员', '设计师', '测试工程师', '数据分析师'];
export const largeRoster = [...agents, ...extraNames.map((displayName, i) => ({ ...clone(agents[i % agents.length]), agentId: 'sample-extra-' + i, displayName, teamRole: extraRoles[i % extraRoles.length], memberOrder: agents.length + i }))];
export const rosterForScenario = scenario => scenario === 'many' ? largeRoster : agents;
export const navigation = { schemaVersion: 3, throughGlobalSequence: 1, projects: [], quickChat: { totalCount: 0, recentCamps: [] } };
export const preferences = () => ({ schemaVersion: 4, startupLocationMode: 'last_location', lastSettingsSection: 'general', executionConsolePlacement: 'bottom', newConversationDefaults: { memberAgentIds: [agents[0].agentId, agents[1].agentId], defaultLeadAgentId: agents[0].agentId }, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: false, worldMapEnabled: false });
export const notifications = () => ({ headsUpEnabled: true, approvalHeadsUpEnabled: true, userMentionHeadsUpEnabled: true, turnCompletedHeadsUpEnabled: true, turnIncompleteHeadsUpEnabled: true, version: 1, updatedAt: now });
export const appearance = () => ({ ...DEFAULT_APPEARANCE, resolvedTheme: 'day', source: 'saved' });
const runtimeStatuses = { 'claude-code-cli': 'ready', 'codex-cli': 'ready', 'opencode-cli': 'missing', 'copilot-cli': 'authentication_required', 'pi': 'ready' };
export function healthSnapshot(allReady = false) {
    return { core: { ok: true, version: '0.0.6', dataDir: '/sample' }, database: { ok: true, path: '/sample' }, git: { installed: true, version: '2.50.0' }, hostPlatform: 'macos-arm64', runtimeCatalog: [],
        runtimePlatformAdmission: VISIBLE_PRODUCT_RUNTIMES.map(runtimeKind => ({ runtimeKind, platform: 'macos-arm64', status: 'qualified', reasonCode: null, evidenceRevision: 'isolated-fixture' })),
        runtimeAvailability: VISIBLE_PRODUCT_RUNTIMES.map(runtimeKind => { const status = allReady ? 'ready' : runtimeStatuses[runtimeKind] ?? 'missing'; return { runtimeKind, status, checking: false, installationId: null, reportedVersion: status === 'ready' ? ({ 'claude-code-cli': '2.1.0', 'codex-cli': '0.101.0', pi: '0.42.0' }[runtimeKind] ?? '1.0.0') : null, failure: null, diagnosticCode: null, discovery: { runtimeKind, discoveryStatus: status === 'missing' ? 'missing' : 'found', executablePath: status === 'missing' ? null : '/sample/bin/' + runtimeKind, source: null, reportedVersion: null, executableFingerprint: null, searchPathSource: null, entrypointKind: null, candidateExtension: null, resolvedNativeTarget: false, versionProbeSucceeded: null, searchGeneration: 1, observedAt: now, diagnosticCode: null } }; }),
        searchEnvironment: { generation: 1, createdAt: now, pathEntryCount: 0, shell: { status: 'captured', interactive: true, shellName: 'sample', entryCount: 0, elapsedMillis: 0 } } };
}
const account = kind => ({ accountId: 'sample-' + kind, userName: 'Murray', tenantName: 'Rovai 工作室', brand: kind, connectedAt: now, lastVerifiedAt: now });
export function channelsSnapshot(disconnected = false) { return { schemaVersion: 4, pendingBindingCount: 0, bindingIssueCount: 0, activeProvisioning: null, activeQrAttempt: null, channels: ['feishu', 'dingtalk'].map(kind => ({ kind, displayName: kind === 'feishu' ? '飞书' : '钉钉', hostStatus: 'ready', connection: { status: disconnected || kind === 'dingtalk' ? 'not_connected' : 'connected', account: disconnected || kind === 'dingtalk' ? null : account(kind) }, memberBots: kind === 'feishu' ? [{ agentId: agents[0].agentId, publicationStatus: 'published', botDisplayName: agents[0].displayName, appId: 'sample-app', managementUrl: null, failureCode: null }] : [] })) }; }
export const executionWeb = () => ({ schemaVersion: 1, enabled: false, port: 8765, server: { state: 'disabled', address: null, errorCode: null } });
export function updateSnapshot(scenario = 'normal') { return { currentVersion: '0.0.6', status: scenario === 'ready' ? 'ready_to_install' : scenario === 'error' ? 'download_failed' : scenario === 'current' ? 'up_to_date' : 'available', availableRelease: scenario === 'current' ? null : { version: '0.0.7', releaseName: 'Rovai AI 0.0.7', releaseDate: now, releaseNotes: '### 本次更新\n\n- 统一设置页的按钮与选择状态。\n- 简化提醒、渠道和诊断页面的说明。\n- 优化运行时安装引导与用量趋势的阅读体验。\n\n隔离测试中的示例更新内容。' }, lastCheckSource: 'manual', checkedAt: now, lastSuccessfulCheckAt: now, downloadPercent: null, transferredBytes: null, totalBytes: null, bytesPerSecond: null, failureReason: scenario === 'error' ? 'network' : null, pendingPrompt: null }; }
function check(id, label, overrides = {}) { return { id, label, group: 'local_dependencies', subjectKind: id, subjectId: null, status: 'ok', code: id + '_ready', detail: '示例检查通过。', observedAt: now, stale: false, facts: [], ...overrides }; }
export function diagnosticsSnapshot(healthy = false) {
    const checks = [check('core', 'Rovai Core', { facts: [{ key: 'version', value: '0.0.6' }] }), check('data-directory', '数据目录'), check('database', '本地数据库', { code: 'database_ready' }), check('git', 'Git', { facts: [{ key: 'version', value: '2.50.0' }] }), check('skill-projections', 'Skills 同步', { group: 'managed_content', code: 'skill_projection_ok' }), check('mcp-config', 'MCP 配置', { group: 'managed_content', code: healthy ? 'mcp_config_valid' : 'mcp_config_permissions_too_broad', status: healthy ? 'ok' : 'attention', facts: [{ key: 'serverCount', value: '2' }, { key: 'expectedMode', value: '0600' }], detail: '配置内容有效；文件访问权限需要收紧。' }), check('runtime:codex-cli', 'Codex', { group: 'agent_runtimes', subjectKind: 'runtime', subjectId: 'codex-cli', facts: [{ key: 'reportedVersion', value: '0.101.0' }] }), check('runtime:claude-code-cli', 'Claude Code', { group: 'agent_runtimes', subjectKind: 'runtime', subjectId: 'claude-code-cli', facts: [{ key: 'reportedVersion', value: '2.1.0' }] }), check('runtime:opencode-cli', 'OpenCode', { group: 'agent_runtimes', subjectKind: 'runtime', subjectId: 'opencode-cli', status: healthy ? 'ok' : 'unknown', code: healthy ? 'runtime_ready' : 'runtime_check_incomplete', detail: '本次检查暂未取得完整的可用性结果。' })];
    return { schemaVersion: 1, checkedAt: now, checks, summary: { ok: checks.filter(c => c.status === 'ok').length, attention: checks.filter(c => c.status === 'attention').length, unknown: checks.filter(c => c.status === 'unknown').length, total: checks.length } };
}
const metricKeys = ['promptInputTotalTokens', 'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningOutputTokens', 'requestCacheHitRate', 'cost'];
const row = (runtimeKind, providerKey, modelKey, input, output, cache, eligible, observed, amount) => ({ runtimeKind, providerKey, modelKey, promptInputTotalTokens: input, uncachedInputTokens: input - cache, cacheReadTokens: cache, cacheWriteTokens: Math.round(input * .05), outputTokens: output, reasoningOutputTokens: Math.round(output * .22), cacheReadShare: input ? cache / input : null, requestCacheHitRate: 0.62, cost: [{ amount, currency: 'USD', kind: 'run', source: 'runtime_reported' }], coverage: { eligibleRuns: eligible, observedRuns: observed } });
const modelRows = [row('codex-cli', 'openai', 'gpt-5.5', 624800, 58430, 301700, 28, 28, '2.48'), row('claude-code-cli', 'anthropic', 'claude-sonnet-4-6', 388620, 49320, 182600, 19, 17, '1.92'), row('pi', 'openai', 'gpt-5.4', 148200, 18230, 67100, 11, 9, '0.76')];
export function monitoringSnapshot(filter = {}, scenario = 'normal') {
    let rows = modelRows.filter(r => (!filter.runtimeKind || r.runtimeKind === filter.runtimeKind) && (!filter.providerKey || r.providerKey === filter.providerKey) && (!filter.modelKey || r.modelKey === filter.modelKey)).map(clone);
    if (scenario === 'empty')
        rows = [];
    const multiplier = filter.range === '30d' ? 8 : filter.range === '7d' ? 3 : 1;
    rows.forEach(r => { for (const k of metricKeys.filter(k => !['requestCacheHitRate', 'cost'].includes(k)))
        r[k] *= multiplier; r.cost[0].amount = (Number(r.cost[0].amount) * multiplier).toFixed(2); if (filter.costKind && filter.costKind !== 'run')
        r.cost = []; });
    const eligible = rows.reduce((n, r) => n + r.coverage.eligibleRuns, 0), observed = rows.reduce((n, r) => n + r.coverage.observedRuns, 0);
    const sum = key => rows.length ? rows.reduce((n, r) => n + (r[key] ?? 0), 0) : null;
    const coverage = Object.fromEntries(metricKeys.map(k => [k, { eligibleRuns: eligible, observedRuns: scenario === 'partial' && ['cacheReadTokens', 'cacheWriteTokens', 'reasoningOutputTokens', 'cost'].includes(k) ? 0 : observed }]));
    const summary = { promptInputTotalTokens: sum('promptInputTotalTokens'), uncachedInputTokens: sum('uncachedInputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheWriteTokens: sum('cacheWriteTokens'), outputTokens: sum('outputTokens'), reasoningOutputTokens: sum('reasoningOutputTokens'), cacheReadShare: rows.length ? sum('cacheReadTokens') / sum('promptInputTotalTokens') : null, requestCacheHitRate: rows.length ? 0.62 : null, cost: { run: rows.length && (!filter.costKind || filter.costKind === 'run') ? [{ amount: rows.reduce((s, r) => s + Number(r.cost[0]?.amount ?? 0), 0).toFixed(2), currency: 'USD', kind: 'run', source: 'runtime_reported' }] : [], reconciliation: [], latestReconciledAt: null, difference: [] } };
    const hourlyWeights = [2, 1, 1, 1, 1, 2, 4, 8, 11, 7, 6, 9, 13, 11, 8, 6, 10, 9, 7, 5, 4, 3, 2, 1];
    const bucketCount = filter.range === '30d' ? 30 : filter.range === '7d' ? 7 : 24;
    const weights = Array.from({ length: bucketCount }, (_, i) => hourlyWeights[i % hourlyWeights.length]);
    const total = weights.reduce((a, b) => a + b, 0);
    const hours = filter.range === '30d' ? 30 * 24 : filter.range === '7d' ? 7 * 24 : 24;
    const start = Date.parse(now) - hours * 3600000;
    const trend = rows.length ? weights.map((w, i) => ({ bucketStartAt: new Date(start + i * hours / bucketCount * 3600000).toISOString(), promptInputTotalTokens: Math.round(summary.promptInputTotalTokens * w / total), uncachedInputTokens: Math.round(summary.uncachedInputTokens * w / total), cacheReadTokens: Math.round(summary.cacheReadTokens * w / total), cacheWriteTokens: Math.round(summary.cacheWriteTokens * w / total), outputTokens: Math.round(summary.outputTokens * w / total), reasoningOutputTokens: Math.round(summary.reasoningOutputTokens * w / total), cacheReadShare: summary.cacheReadShare, requestCacheHitRate: summary.requestCacheHitRate, cost: filter.range === '30d' ? [
        { amount: '88.7653316', currency: 'USD', kind: 'run', source: 'price_catalog' },
        { amount: '1.44650899999999996', currency: 'USD', kind: 'run', source: 'runtime_reported' }
    ] : null })) : [];
    if (scenario === 'partial') {
        for (const k of ['cacheReadTokens', 'cacheWriteTokens', 'cacheReadShare', 'reasoningOutputTokens'])
            summary[k] = null;
        summary.cost = null;
        for (const r of [...rows, ...trend]) {
            r.cacheReadTokens = null;
            r.cacheWriteTokens = null;
            r.reasoningOutputTokens = null;
            r.cacheReadShare = null;
            r.cost = [];
        }
    }
    return { schemaVersion: 2, collection: { epoch: 'sample-epoch', startedAt: new Date(start).toISOString() }, range: { from: new Date(start).toISOString(), to: now }, summary, trend, byRuntime: rows.map(r => ({ ...r, providerKey: null, modelKey: null })), byModel: rows, coverage };
}
