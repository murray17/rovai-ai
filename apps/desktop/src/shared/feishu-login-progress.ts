export type FeishuLoginStage =
  | 'loading_local_session'
  | 'preparing'
  | 'awaiting_scan'
  | 'awaiting_refresh'
  | 'scan_confirmed'
  | 'completing_login'
  | 'inspecting_identity'
  | 'saving_local_session'
  | 'connected'
  | 'expired'
  | 'cancelled'
  | 'failed'

const LOGIN_STAGES: readonly FeishuLoginStage[] = [
  'loading_local_session', 'preparing', 'awaiting_scan', 'scan_confirmed',
  'completing_login', 'inspecting_identity', 'saving_local_session', 'connected'
]

export function canAdvanceFeishuLoginStage(current: FeishuLoginStage, next: FeishuLoginStage): boolean {
  if (current === next || ['connected', 'expired', 'awaiting_refresh', 'cancelled', 'failed'].includes(current)) return false
  return !LOGIN_STAGES.includes(next) || LOGIN_STAGES.indexOf(next) > LOGIN_STAGES.indexOf(current)
}

const LOGIN_FAILURE_DETAILS: Readonly<Record<string, string>> = {
    feishu_developer_identity_incomplete:
      '已登录飞书，但未能读取完整的账号与企业信息。请关闭后重试。',
    feishu_login_failed: '飞书扫码登录未完成，请关闭后重试。',
    feishu_login_expired: '二维码已过期，请点击刷新后重新扫码。',
    feishu_login_timeout: '请刷新二维码后继续扫码。',
    feishu_request_timeout: '飞书请求超时，请检查网络后重试。',
    feishu_network_error: '无法连接飞书，请检查网络后重试。',
    feishu_login_server_rejected: '飞书拒绝了本次登录请求，请稍后重试。',
    feishu_login_handoff_failed: '飞书登录会话未能建立，请关闭后重试。',
    feishu_login_identity_selection_required: '飞书要求选择账号或企业，请先在飞书开放平台完成身份选择，再重新扫码。',
    feishu_login_authorization_required: '飞书要求补充授权，请先在飞书开放平台完成授权，再重新扫码。',
    feishu_login_verification_required: '飞书要求额外验证，请先在飞书开放平台完成验证，再重新扫码。',
    feishu_login_interaction_required: '飞书需要额外交互，请先在飞书开放平台完成操作，再重新扫码。',
    feishu_login_protocol_incomplete: '飞书未返回完整的扫码信息，请稍后重试；若持续失败，需要更新登录适配器。',
    feishu_login_protocol_invalid: '飞书登录响应格式已变化，需要更新登录适配器。',
    feishu_login_protocol_unsupported: '飞书返回了暂不支持的登录步骤，需要更新登录适配器。',
    feishu_login_protocol_redirect: '飞书登录入口已变化，需要更新登录适配器。',
    feishu_open_platform_bootstrap_unsupported: '飞书账号数据格式已变化，需要更新登录适配器。',
    feishu_open_platform_bootstrap_incomplete: '飞书开放平台未返回完整的会话信息，请关闭后重试。',
    feishu_local_save_failed: '连接未能保存到 Rovai 本地，原连接已保留，请稍后重试。',
    feishu_open_platform_http_error: '飞书开放平台暂时无法访问，请稍后重试。',
    feishu_session_url_rejected: '飞书返回了不受信任的登录地址，已停止连接。',
    feishu_session_redirect_invalid: '飞书返回了无效跳转，已停止连接。',
    feishu_session_redirect_limit: '飞书登录跳转次数过多，请稍后重试。',
    feishu_open_platform_origin_rejected: '飞书开放平台站点与登录会话不一致，已停止操作。',
    feishu_login_protocol_url_rejected: '飞书扫码入口不受支持，需要更新登录适配器。',
    feishu_login_profile_invalid: '飞书登录配置不完整，需要更新登录适配器。',
    feishu_response_too_large: '飞书响应超出可处理范围，已停止本次操作。'
}

export function feishuLoginFailureDetail(code: string): string | undefined {
  return LOGIN_FAILURE_DETAILS[code]
}
