//! Windows transport owner for the existing complete_pending/redaction matrix.
//! A native cmd/PowerShell child establishes the Host. No service credentials or model.
use super::*;
use rovai_core::agent_profile::{AdapterPermissionConfig, ResolvedModelSelection};

#[tokio::test]
async fn native_windows_complete_pending_preserves_resume_fields_and_redacts_output() {
    let root = crate::platform::private_storage::create_private_directory(
        &std::env::temp_dir().join(format!("rovai resume test {}", uuid::Uuid::new_v4())),
    )
    .unwrap();
    let executable = root.join("fixture.cmd");
    let powershell = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    std::fs::write(root.join("fixture.ps1"), r#"
$request = [Console]::ReadLine() | ConvertFrom-Json
@{ jsonrpc = '2.0'; id = $request.id; result = @{ protocolVersion = 1; agentCapabilities = @{} } } | ConvertTo-Json -Compress
while ($null -ne [Console]::ReadLine()) {}
"#).unwrap();
    std::fs::write(&executable, format!(
        "@echo off\r\n\"{}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%~dp0fixture.ps1\"\r\n", powershell.display()
    )).unwrap();
    let frozen = FrozenAgentRuntimeConfig {
        environment: Some(rovai_core::member_environment::LaunchEnvironment {
            values: Some(BTreeMap::from([
                ("SystemRoot".into(), std::env::var("SystemRoot").unwrap()),
                ("ComSpec".into(), std::env::var("ComSpec").unwrap()),
                ("USERPROFILE".into(), root.to_string_lossy().into_owned()),
                ("HOME".into(), root.to_string_lossy().into_owned()),
                ("AUTH_ENABLED".into(), "1".into()),
                ("XAI_API_KEY".into(), "wire-stdout".into()),
                ("OPENAI_API_KEY".into(), "test".into()),
                ("ANTHROPIC_API_KEY".into(), "IDENTIFIER".into()),
            ])),
            overlay: None,
        }),
        custom_api: None,
        camp_fast: None,
        adapter_kind: AdapterKind::KimiCodeCli,
        installation_id: "isolated-windows-fixture".into(),
        installation_generation: 1,
        search_environment_generation: 1,
        executable_path: executable.to_string_lossy().into_owned(),
        auth_scope: "default".into(),
        reported_version: Some("0.38.0".into()),
        executable_fingerprint: "sha256:fixture".into(),
        capabilities: vec![],
        protocol_version: "acp-v1".into(),
        model: ResolvedModelSelection {
            dsh_source: None,
            source: "runtime_default".into(),
            model_id: "runtime_default".into(),
            options: json!({}),
        },
        permissions: AdapterPermissionConfig {
            adapter_kind: AdapterKind::KimiCodeCli,
            schema_version: 1,
            values: json!({"permission_mode":"default"}),
        },
        native_session_compatibility_key: None,
        binding_compatibility_digest: "sha256:binding".into(),
        host_config_digest: "sha256:host".into(),
        config_digest: "sha256:config".into(),
    };
    let (incoming, mut receiver) = mpsc::unbounded_channel();
    let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().into_owned());
    let host = AcpHost::spawn(
        &root,
        &workspace,
        PermissionSemantics::RuntimeManagedV2,
        &frozen,
        incoming,
        None,
        CompactionDetectorPolicy::Disabled,
        false,
        &BTreeMap::new(),
        &root.join("private"),
        None,
    )
    .await
    .unwrap();
    super::resume_error_fixture::assert_error_delivery(&host).await;
    host.send_host_diagnostic("test failure: wire-stdout IDENTIFIER".into());
    let diagnostic = receiver.recv().await.unwrap();
    assert!(
        matches!(diagnostic, AcpIncoming::HostDiagnostic { text, .. }
        if text == "[redacted] failure: [redacted] [redacted]")
    );
    host.shutdown().await;
    std::fs::remove_dir_all(root).unwrap();
}
