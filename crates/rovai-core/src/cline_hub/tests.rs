use super::*;

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
            settled:AtomicBool::new(false),sequence:AtomicU64::new(1),terminal:RwLock::new((None,None)),tools:Mutex::new(HashMap::new()),
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
