use super::*;

fn runtime_for(host: Arc<ClineHubHost>, session: String) -> Arc<ClineHubRuntime> {
    Arc::new(ClineHubRuntime {
        host,
        run: "native-protocol-review".into(),
        camp: "isolated-review".into(),
        epoch: 1,
        session,
        prompt: uuid::Uuid::new_v4().to_string(),
        delivery: "isolated-delivery".into(),
        native_run: RwLock::new(None),
        submitted: AtomicBool::new(false),
        observed_model: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        settled: AtomicBool::new(false),
        sequence: AtomicU64::new(1),
        terminal: RwLock::new((None, None)),
        failure: RwLock::new(None),
        tools: Mutex::new(HashMap::new()),
        approvals: Mutex::new(HashMap::new()),
        denied_tools: Mutex::new(HashSet::new()),
        bootstrap: "Isolated protocol review".into(),
        mode: "act".into(),
    })
}

#[tokio::test]
#[ignore = "Real selected Cline CLI and isolated provider configuration; protocol-only, no model request"]
async fn installed_hub_known_rejection_and_large_history_cold_restore() {
    use anyhow::ensure;
    let executable = PathBuf::from(std::env::var("ROVAI_CLINE_HUB_ACCEPTANCE_EXECUTABLE").unwrap());
    let root = std::env::temp_dir().join(format!("rovai-hub-review-{}", uuid::Uuid::new_v4()));
    config::private_dir(&root).unwrap();
    let launch = HubHostLaunch {
        executable,
        selected_model: None,
        cwd: root.clone(),
        bootstrap: "Isolated protocol review".into(),
        servers: BTreeMap::new(),
        builtin_tools: None,
    };
    let (tx, mut rx) = mpsc::unbounded_channel();
    let first = ClineHubHost::spawn(
        &launch,
        root.join("first"),
        root.join("history"),
        tx.clone(),
    )
    .await
    .unwrap();
    let mut second = None;
    let result = async {
        let messages = json!([{"id":"synthetic-history", "role":"user", "content":[{"type":"text","text":format!("early-marker-{}-late-marker", "x".repeat(17 * 1024 * 1024))}]}]);
        let digest = crate::command::canonical_json_digest(&messages)?;
        let created = first.command("session.create", json!({"workspaceRoot":root,"sessionConfig":first.session_config,"initialMessages":messages}), None).await?;
        let session = created["session"]["sessionId"].as_str().context("missing Session")?.to_owned();
        ensure!(first.force_reap_until(Instant::now() + Duration::from_secs(5)).await, "first host not reaped");
        let host = ClineHubHost::spawn(&launch, root.join("second"), root.join("history"), tx).await?;
        second = Some(host.clone());
        let fetched = host.command("session.get", json!({}), Some(&session)).await?;
        ensure!(fetched["session"]["sessionId"] == session, "cold identity mismatch");
        let mut history = host.command("session.messages", json!({}), Some(&session)).await?;
        ensure!(crate::command::canonical_json_digest(&history["messages"])? == digest, "native cold history changed");
        let mut configuration = host.session_config.clone();
        configuration["sessionId"] = json!(session);
        let restored = host.command("session.create", json!({"workspaceRoot":root,"sessionConfig":configuration,"initialMessages":history["messages"].take()}), None).await?;
        ensure!(restored["session"]["sessionId"] == session, "native restore replaced identity");
        let reread = host.command("session.messages", json!({}), Some(&session)).await?;
        ensure!(crate::command::canonical_json_digest(&reread["messages"])? == digest, "restored history changed");

        // A missing native Session rejects before model execution. Exercise the
        // production receive -> start_prompt -> shared failure view boundary.
        let runtime = runtime_for(host.clone(), format!("missing-{}", uuid::Uuid::new_v4()));
        *host.owner.write().await = Arc::downgrade(&runtime);
        runtime.start_prompt("Do not execute: nonexistent Session fixture").await?;
        timeout(Duration::from_secs(15), async {
            while let Some(event) = rx.recv().await {
                if matches!(event, HubIncoming::Event { event, .. } if event == "settled") { break; }
            }
        }).await?;
        ensure!(runtime.terminal().await.1.as_deref() == Some("failed"), "native rejection became unknown");
        let failure = runtime.terminal_failure().await.context("missing public failure")?;
        ensure!(failure.code == "cline_hub_native_session_not_found" && !failure.retryable, "native failure classification lost");
        ensure!(runtime.start_prompt("must never replay").await.is_err(), "input replay admitted");
        ensure!(!runtime.observed_model.load(Ordering::Acquire), "unexpected model execution");

        // Hub replaces the retired ACP-only tool observation owner.
        runtime.normalize("tool.started", &json!({"toolCallId":"denied", "toolName":"apply_patch", "input":{"input":"*** Begin Patch\n*** Add File: denied.txt\n+private\n*** End Patch"}})).await?;
        runtime.denied_tools.lock().await.insert("denied".into());
        let (public, completion) = runtime.normalize("tool.finished", &json!({"toolCallId":"denied", "toolName":"apply_patch", "output":{"success":false}, "error":"denied"})).await?;
        ensure!(completion.is_none() && public.context("missing denied evidence")?.1["runtimeDiff"].is_null(), "denial invented side effects");
        println!("Native Hub protocol review: 17 MiB exact-history cold restore, same Session ID, known failure, no replay, denied tool without side effects; model executions=0");
        Ok::<_, anyhow::Error>(())
    }.await;
    let mut reaped = first
        .force_reap_until(Instant::now() + Duration::from_secs(5))
        .await;
    if let Some(host) = second {
        reaped &= host
            .force_reap_until(Instant::now() + Duration::from_secs(5))
            .await;
    }
    assert!(
        reaped,
        "owned hosts remain; preserve private recovery files"
    );
    std::fs::remove_dir_all(root).unwrap();
    result.unwrap();
}

#[tokio::test]
#[ignore = "Real selected Cline CLI and explicitly isolated native provider credentials; incurs model usage"]
async fn installed_hub_rule_approval_usage_and_cleanup() {
    let executable = PathBuf::from(
        std::env::var("ROVAI_CLINE_HUB_ACCEPTANCE_EXECUTABLE")
            .expect("explicit selected CLI required"),
    );
    let root = std::env::temp_dir().join(format!(
        "rovai-cline-hub-acceptance-{}",
        uuid::Uuid::new_v4()
    ));
    config::private_dir(&root).unwrap();
    let bootstrap =
        "Your system identity is HUB_PRODUCT_IDENTITY. Always report it when asked.".to_owned();
    let launch = HubHostLaunch {
        executable,
        selected_model: None,
        cwd: root.clone(),
        bootstrap: bootstrap.clone(),
        servers: BTreeMap::new(),
        builtin_tools: None,
    };
    let (tx, mut rx) = mpsc::unbounded_channel();
    let host = ClineHubHost::spawn(&launch, root.join("host"), root.join("history"), tx)
        .await
        .unwrap();
    let result = async {
        let created = host.command("session.create",json!({"workspaceRoot":root,"sessionConfig":host.session_config,"toolPolicies":{"*":{"autoApprove":false}},
            "runtimeOptions":{"configExtensions":["rules","skills","workflows","plugins","hooks"],"clientContributions":[
            {"kind":"hook","name":"beforeRun","capabilityName":"rovai.beforeRun"},
            {"kind":"hook","name":"beforeModel","capabilityName":"rovai.beforeModel"},
            {"kind":"hook","name":"afterModel","capabilityName":"rovai.afterModel"}]}}),None).await?;
        let session = created["session"]["sessionId"].as_str().context("missing Session")?.to_owned();
        let runtime = Arc::new(ClineHubRuntime { host:host.clone(),run:"smoke-run".into(),camp:"smoke-camp".into(),epoch:1,session,
            prompt:uuid::Uuid::new_v4().to_string(),delivery:"smoke-delivery".into(),native_run:RwLock::new(None),submitted:AtomicBool::new(false),observed_model:AtomicBool::new(false),cancelled:AtomicBool::new(false),
            settled:AtomicBool::new(false),sequence:AtomicU64::new(1),terminal:RwLock::new((None,None)),failure:RwLock::new(None),tools:Mutex::new(HashMap::new()),
            approvals:Mutex::new(HashMap::new()),denied_tools:Mutex::new(HashSet::new()),bootstrap,mode:"act".into() });
        *host.owner.write().await = Arc::downgrade(&runtime);
        runtime.start_prompt("Try to write denied.txt with native apply_patch. Do not retry denial. Then state your system identity and say whether writing was denied.").await?;
        let mut accepted = false; let mut approvals = 0; let mut usage = false; let mut denied_result = false;
        timeout(Duration::from_secs(150),async {
            while let Some(event) = rx.recv().await {
                match event {
                    HubIncoming::Event {event,..} if event == "accepted" => accepted = true,
                    HubIncoming::Event {event,payload,..} if event == "approval.requested" => {
                        approvals += 1; runtime.respond(payload["approvalId"].clone(),json!({"approved":false})).await?;
                    },
                    HubIncoming::Event {event,payload,..} if event == "model.metrics" => { usage |= crate::cline::parse_usage(&payload).is_some(); },
                    HubIncoming::Event {event,payload,..} if event == "tool.started" || event == "tool.finished" => {
                        let (_,completion) = runtime.normalize(&event,&payload).await?;
                        if event == "tool.finished" { assert!(completion.is_none(), "a denied tool must not create an observed side effect"); denied_result = true; }
                    },
                    HubIncoming::Event {event,..} if event == "settled" => break,
                    HubIncoming::Exited {..} => bail!("unexpected Hub exit"),
                    _ => {},
                }
            }
            Ok::<_,anyhow::Error>(())
        }).await??;
        let (text,reason) = runtime.terminal().await;
        assert!(accepted); assert!(approvals > 0); assert!(usage); assert!(denied_result);
        assert_eq!(reason.as_deref(),Some("stop"));
        assert!(text.as_deref().is_some_and(|s|s.contains("HUB_PRODUCT_IDENTITY")));
        assert!(!root.join("denied.txt").exists());
        println!("Cline Hub: real native acceptance, frozen System Rule, denied write without side effect, sparse Usage and native terminal verified");
        Ok::<_,anyhow::Error>(())
    }.await;
    assert!(
        host.force_reap_until(Instant::now() + Duration::from_secs(5))
            .await,
        "owned process tree cleanup must be confirmed"
    );
    std::fs::remove_dir_all(&root).unwrap();
    result.unwrap();
}
