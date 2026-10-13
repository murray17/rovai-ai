//! Existing resume-error matrix shared by Unix terminal and native Windows owners.
use super::*;

pub(super) async fn assert_error_delivery(host: &AcpHost) {
    let project = if cfg!(windows) {
        r"C:\work test\project"
    } else {
        "/work/test/project"
    };
    // Classification needs the original machine fields even when a short
    // credential is also a substring of the target, path or reason code.
    for (kind, method, code, mut data) in [
        (
            AdapterKind::QoderCli,
            "session/resume",
            -32602,
            json!({"code":"INVALID_SESSION_IDENTIFIER","sessionId":"session-test","projectRoot":project}),
        ),
        (
            AdapterKind::CopilotCli,
            "session/load",
            -32002,
            json!({"uri":"Session session-test not found"}),
        ),
        (
            AdapterKind::QwenCode,
            "session/resume",
            -32002,
            json!({"uri":"session:session-test"}),
        ),
    ] {
        data["error"] = json!("test provider detail IDENTIFIER");
        let (sender, error_response) = oneshot::channel();
        host.complete_pending(
                999,
                PendingRpc::Response { sender, method: method.into() },
                json!({"id":999,"error":{"code":code,"message":"wire-stdout test IDENTIFIER failure 1","data":data}}),
            ).await;
        let detail = error_response.await.unwrap().unwrap_err();
        let typed = detail.downcast_ref::<AcpRpcError>().unwrap();
        assert_eq!(typed.code, Some(code));
        assert!(typed.rejects_restore_target(kind, "session-test", project));
        assert!(!typed.rejects_restore_target(kind, "session-other", "/work/other/project"));
        assert!(detail.to_string().contains("failure 1"));
        assert!(detail.to_string().contains("[redacted]"));
        for secret in ["wire-stdout", "test", "IDENTIFIER"] {
            assert!(!detail.to_string().contains(secret));
        }
        for formatted in [
            typed.to_string(),
            format!("{typed:?}"),
            format!("{typed:#?}"),
            detail.to_string(),
            format!("{detail:#}"),
            format!("{detail:?}"),
            format!("{detail:#?}"),
        ] {
            // Anyhow may append a backtrace with Rust's `tests` namespace.
            // Check the actual native values rather than that unrelated word.
            for secret in ["wire-stdout", "IDENTIFIER", "session-test", project] {
                assert!(
                    !formatted.contains(secret),
                    "RPC error formatting leaked a credential"
                );
            }
        }
    }
}

#[test]
fn acp_rpc_error_keeps_only_allowlisted_bounded_fields() {
    let error = AcpRpcError::from_response(&json!({
        "code": -32000,
        "message": "transport failed",
        "data": { "code": "ECONNRESET" }
    }));
    assert_eq!(error.structured_code.as_deref(), Some("ECONNRESET"));

    let rejected = AcpRpcError::from_response(&json!({
        "message": "transport failed",
        "data": { "code": "not safe because it has spaces" }
    }));
    assert!(rejected.structured_code.is_none());

    let provider_detail = AcpRpcError::from_response(&json!({
        "code": -32603,
        "message": "Internal error",
        "data": {
            "error": "failed to call agent: Model usage has reached personal quota limit. Please check usage or contact administrator."
        }
    }));
    assert_eq!(
        provider_detail.diagnostic(),
        "ACP error -32603: Internal error: failed to call agent: Model usage has reached personal quota limit. Please check usage or contact administrator."
    );

    let redacted_detail = AcpRpcError::from_response(&json!({
        "code": -32603,
        "message": "Internal error",
        "data": { "error": "provider failed with api_key=must-not-leak" }
    }));
    assert_eq!(
        redacted_detail.diagnostic(),
        "ACP error -32603: Internal error: provider failed with api_key=[redacted]"
    );

    let unlisted_detail = AcpRpcError::from_response(&json!({
        "code": -32603,
        "message": "Internal error",
        "data": { "detail": "must remain private" }
    }));
    assert_eq!(
        unlisted_detail.diagnostic(),
        "ACP error -32603: Internal error"
    );

    for (kind, code, data, expected) in [
        (
            AdapterKind::CopilotCli,
            -32002,
            json!({"uri":"Session old not found"}),
            true,
        ),
        (
            AdapterKind::QwenCode,
            -32002,
            json!({"uri":"session:old"}),
            true,
        ),
        (AdapterKind::CopilotCli, -32002, json!({}), false),
        (AdapterKind::QwenCode, -32002, json!({}), false),
        (
            AdapterKind::CopilotCli,
            -32002,
            json!({"uri":"Session another not found"}),
            false,
        ),
        (
            AdapterKind::QwenCode,
            -32002,
            json!({"uri":"session:another"}),
            false,
        ),
        (
            AdapterKind::QwenCode,
            -32002,
            json!({"uri":"file:///missing-config"}),
            false,
        ),
        (AdapterKind::KimiCodeCli, -32002, json!({}), false),
        (AdapterKind::QwenCode, -32602, json!({}), false),
        (AdapterKind::CopilotCli, -32603, json!({}), false),
        (AdapterKind::ZcodeApp, -32004, json!({}), true),
        (AdapterKind::ZcodeApp, -32000, json!({}), false),
        (
            AdapterKind::QoderCli,
            -32602,
            json!({"code":"INVALID_SESSION_IDENTIFIER","sessionId":"old","projectRoot":"/project"}),
            true,
        ),
        (
            AdapterKind::QoderCli,
            -32603,
            json!({"code":"INVALID_SESSION_IDENTIFIER","sessionId":"old","projectRoot":"/project"}),
            false,
        ),
        (
            AdapterKind::QoderCli,
            -32602,
            json!({"code":"INVALID_SESSION_IDENTIFIER","sessionId":"another","projectRoot":"/project"}),
            false,
        ),
        (
            AdapterKind::QoderCli,
            -32602,
            json!({"code":"INVALID_SESSION_IDENTIFIER","sessionId":"old","projectRoot":"/another"}),
            false,
        ),
        (
            AdapterKind::QoderCli,
            -32602,
            json!({"sessionId":"old","projectRoot":"/project"}),
            false,
        ),
    ] {
        let error = AcpRpcError::from_response(&json!({
            "code":code,"message":"incompatible not found method not found","data":data
        }));
        assert_eq!(
            error.rejects_restore_target(kind, "old", "/project"),
            expected,
            "{kind:?}: {error:?}"
        );
    }
    let oversized = AcpRpcError::from_response(&json!({"data":{
        "code":"x".repeat(65), "uri":"x".repeat(1025), "sessionId":"x".repeat(257), "projectRoot":"x".repeat(32769)
    }}));
    assert!(oversized.structured_code.is_none());
    assert!(oversized.resource_uri.is_none());
    assert!(oversized.session_id.is_none());
    assert!(oversized.project_root.is_none());
}

// Owns CodeBuddy's false-success filesystem boundary. Protocol parser tests
// cannot prove that a different Session file is not accepted as this target.
#[tokio::test]
async fn codebuddy_restore_verifies_only_the_exact_file_in_the_launch_environment() {
    let root =
        std::env::temp_dir().join(format!("rovai-codebuddy-restore-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let mut command = Command::new(if cfg!(windows) {
        "C:/Windows/System32/cmd.exe"
    } else {
        "/bin/sh"
    });
    command
        .current_dir(&root)
        .env("HOME", root.join("unrelated-home"))
        .env("CODEBUDDY_CONFIG_DIR", "native");
    let spec = ManagedProcessLaunchSpec::capture(
        &command,
        ManagedProcessPurpose::RuntimeHost,
        ManagedStdinPolicy::Null,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        "codebuddy-restore-test",
    )
    .unwrap();
    command.env("CODEBUDDY_CONFIG_DIR", "new-config");
    let native = codebuddy_config_dir(&spec).unwrap();
    assert_eq!(native, root.join("native"));
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = root.to_str().unwrap();
    let path = crate::native_usage::codebuddy_session_path(&native, cwd, &session_id);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path.with_file_name("another-session.jsonl"), "{}").unwrap();
    let missing = verify_codebuddy_restore_target(&native, &session_id, cwd)
        .await
        .unwrap_err();
    assert_eq!(
        missing.downcast_ref::<crate::runtime::NativeSessionResumeFailure>(),
        Some(&crate::runtime::NativeSessionResumeFailure::Incompatible)
    );
    std::fs::write(&path, "{}").unwrap();
    verify_codebuddy_restore_target(&native, &session_id, cwd)
        .await
        .unwrap();
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    for target in [&session_id, "../../unrelated"] {
        let error = verify_codebuddy_restore_target(&native, target, cwd)
            .await
            .unwrap_err();
        assert!(
            error
                .downcast_ref::<crate::runtime::NativeSessionResumeFailure>()
                .is_none()
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}
