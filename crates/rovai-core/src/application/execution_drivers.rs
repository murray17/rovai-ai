use super::*;
use tokio::sync::watch;

// Only transient failures arm this delay. There is no idle retry timer.
const DRIVER_RETRY_DELAY: Duration = Duration::from_secs(3);
// A native resume signal is available on Desktop, but wall-clock adjustments and
// standalone hosts also need bounded time re-observation. This never scans SQL.
const CLOCK_RECHECK: Duration = Duration::from_secs(30);

enum Wake {
    Changed,
    Deadline,
    Shutdown,
}

async fn wait_for_wake(
    notify: &Notify,
    deadline: Option<tokio::time::Instant>,
    shutdown: &mut watch::Receiver<bool>,
) -> Wake {
    if *shutdown.borrow() {
        return Wake::Shutdown;
    }
    tokio::select! {
        biased;
        _ = shutdown.changed() => Wake::Shutdown,
        _ = notify.notified() => Wake::Changed,
        _ = async {
            match deadline {
                Some(at) => tokio::time::sleep_until(at).await,
                None => std::future::pending().await,
            }
        } => Wake::Deadline,
    }
}

fn wall_reminder(
    at: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<tokio::time::Instant> {
    at.map(|at| {
        tokio::time::Instant::now()
            + at.signed_duration_since(now)
                .to_std()
                .unwrap_or_default()
                .min(CLOCK_RECHECK)
    })
}

pub(super) fn start_execution_workers(
    core: &Arc<Core>,
    shutdown: watch::Receiver<bool>,
) -> tokio::task::JoinSet<()> {
    let mut workers = tokio::task::JoinSet::new();
    workers.spawn(process_non_batch_runs(core.clone(), shutdown.clone()));
    workers.spawn(process_automation_deadlines(core.clone(), shutdown.clone()));
    workers.spawn(process_execution_budgets(core.clone(), shutdown.clone()));
    workers.spawn(process_text_retries(core.clone(), shutdown.clone()));
    workers.spawn(process_runtime_authorizations(
        core.clone(),
        shutdown.clone(),
    ));
    workers.spawn(process_runtime_cancellations(
        core.clone(),
        shutdown.clone(),
    ));
    workers.spawn(process_housekeeping(core.clone(), shutdown.clone()));
    workers
}

pub(super) async fn process_non_batch_runs(core: Arc<Core>, mut shutdown: watch::Receiver<bool>) {
    let (completed_tx, mut completed_rx) = tokio::sync::mpsc::unbounded_channel();
    // Each in-flight preparation retains whether a state-change wake arrived.
    let mut inflight = HashMap::new();
    let mut pending = std::collections::VecDeque::new();
    let mut scan = true;
    loop {
        if *shutdown.borrow() {
            break;
        }
        if scan {
            scan = false;
            let result = async {
                dispatch_pending_single_chat_inputs(&core).await?;
                let candidates = {
                    let database = core.database.lock().await;
                    let mut candidates = Vec::new();
                    let mut offset = 0;
                    loop {
                        let mut page = ExecutionRuntimeService::default()
                            .list_dispatchable_non_batch_agent_runs_page(
                                &database,
                                NON_BATCH_AGENT_RUN_DISPATCH_LIMIT,
                                offset,
                            )?;
                        let count = page.len() as i64;
                        candidates.append(&mut page);
                        if count < NON_BATCH_AGENT_RUN_DISPATCH_LIMIT {
                            break;
                        }
                        offset += count;
                    }
                    candidates
                };
                pending = candidates.into();
                Ok::<(), anyhow::Error>(())
            }
            .await;
            if let Err(error) = result {
                eprintln!("non-batch execution check deferred: {error:#}");
                core.defer_non_batch_dispatch(DRIVER_RETRY_DELAY).await;
            }
        }
        while inflight.len() < NON_BATCH_AGENT_RUN_DISPATCH_LIMIT as usize {
            let Some(candidate) = pending.pop_front() else {
                break;
            };
            if inflight.contains_key(&candidate.agent_run_id) {
                continue;
            }
            let id = candidate.agent_run_id.clone();
            let worker_core = core.clone();
            let completion = PreparationCompletion {
                run_id: id.clone(),
                sender: completed_tx.clone(),
                result: None,
            };
            inflight.insert(id, false);
            let mut tasks = core.agent_run_tasks.lock().await;
            while tasks.try_join_next().is_some() {}
            tasks.spawn(async move {
                let mut completion = completion;
                worker_core
                    .dispatch_agent_run_candidate(candidate, worker_core.output.clone())
                    .await;
                let database = worker_core.database.lock().await;
                completion.result = Some(
                    ExecutionRuntimeService::default()
                        .load_dispatchable_agent_run(&database, &completion.run_id)
                        .map(|candidate| candidate.is_none()),
                );
            });
            drop(tasks);
            tokio::task::yield_now().await;
            if *shutdown.borrow() {
                break;
            }
        }
        let retry = *core.non_batch_retry_at.lock().await;
        tokio::select! {
            biased;
            Some((id, result)) = completed_rx.recv() => {
                let changed_during_preparation = inflight.remove(&id).unwrap_or(false);
                match result {
                    Ok(progress) => scan |= progress || changed_during_preparation,
                    Err(error) => {
                        eprintln!("non-batch preparation deferred: {error:#}");
                        core.defer_non_batch_dispatch(DRIVER_RETRY_DELAY).await;
                    }
                }
            }
            wake = wait_for_wake(&core.execution_wake.runs, retry, &mut shutdown) => {
                match wake {
                    Wake::Shutdown => break,
                    Wake::Changed => {
                        // This scan skips in-flight Runs. Recheck each once after
                        // completion, even if preparation reports no progress.
                        inflight.values_mut().for_each(|changed| *changed = true);
                        scan = true;
                    }
                    Wake::Deadline => {
                        let mut at = core.non_batch_retry_at.lock().await;
                        if at.is_some_and(|at| at <= tokio::time::Instant::now()) { *at = None; }
                        scan = true;
                    }
                }
            }
        }
    }
    // Preparation lives in Core's tracked task set, including forced shutdown.
}

// A completion always releases the local in-flight slot, including panic/abort.
// This channel carries task completion only; SQL remains the work queue.
struct PreparationCompletion {
    run_id: String,
    sender: tokio::sync::mpsc::UnboundedSender<(String, Result<bool>)>,
    result: Option<Result<bool>>,
}

impl Drop for PreparationCompletion {
    fn drop(&mut self) {
        let result = self
            .result
            .take()
            .unwrap_or_else(|| Err(anyhow::anyhow!("preparation aborted")));
        let _ = self.sender.send((self.run_id.clone(), result));
    }
}

pub(super) async fn process_automation_deadlines(
    core: Arc<Core>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut clock = crate::automation_clock::AutomationClock::start();
    let mut next = None;
    let mut scan = true;
    loop {
        if *shutdown.borrow() {
            break;
        }
        let mut retry = None;
        {
            let control = core.automation_scheduler_control.read().await;
            if control.is_some_and(|value| value.paused) {
                next = None;
            } else if let Some((now, boundary)) = clock.tick() {
                if scan || next.is_some_and(|at| at <= now) {
                    let boundary =
                        control.map_or(boundary, |value| boundary.max(value.recovery_boundary));
                    let result = async {
                        // Settlement and overlap admission remain serialized inside this call.
                        core.process_automations(now, boundary).await?;
                        let database = core.database.lock().await;
                        AutomationService::default().next_wake_at(&database, now)
                    }
                    .await;
                    match result {
                        Ok(at) => next = at,
                        Err(error) => {
                            eprintln!("Automation check deferred: {error:#}");
                            retry = Some(tokio::time::Instant::now() + DRIVER_RETRY_DELAY);
                        }
                    }
                }
            } else {
                // An uncertain sample (including the first observation after sleep)
                // must receive another opportunity without the removed tick.
                retry = Some(tokio::time::Instant::now() + DRIVER_RETRY_DELAY);
            }
        }
        let reminder = retry.or_else(|| wall_reminder(next, chrono::Utc::now()));
        match wait_for_wake(&core.execution_wake.automation, reminder, &mut shutdown).await {
            Wake::Shutdown => break,
            Wake::Changed => scan = true,
            Wake::Deadline => {
                scan = retry.is_some() || next.is_some_and(|at| at <= chrono::Utc::now());
                tokio::task::yield_now().await;
            }
        }
    }
}

pub(super) async fn process_execution_budgets(
    core: Arc<Core>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut next = None;
    let mut scan = true;
    loop {
        if *shutdown.borrow() {
            break;
        }
        let mut retry = None;
        if scan {
            let result: Result<Option<chrono::DateTime<chrono::Utc>>> = async {
                while core.expire_elapsed_execution_budgets(&core.output).await? == 100 {
                    tokio::task::yield_now().await;
                    if *shutdown.borrow() { return Ok(None); }
                }
                let database = core.database.lock().await;
                let at: Option<String> = database.connection().query_row(
                    "SELECT MIN(execution_budget_deadline_at) FROM camp_turn
                     WHERE status IN ('running','waiting') AND execution_budget_exhausted_at IS NULL",
                    [], |row| row.get(0),
                )?;
                at.map(|at| chrono::DateTime::parse_from_rfc3339(&at).map(|at| at.with_timezone(&chrono::Utc)).map_err(Into::into)).transpose()
            }.await;
            match result {
                Ok(at) => next = at,
                Err(error) => {
                    eprintln!("execution budget check deferred: {error:#}");
                    retry = Some(tokio::time::Instant::now() + DRIVER_RETRY_DELAY);
                }
            }
        }
        let reminder = retry.or_else(|| wall_reminder(next, camp_turn_execution_budget_now()));
        match wait_for_wake(&core.execution_wake.budgets, reminder, &mut shutdown).await {
            Wake::Shutdown => break,
            Wake::Changed => scan = true,
            Wake::Deadline => {
                scan =
                    retry.is_some() || next.is_some_and(|at| at <= camp_turn_execution_budget_now())
            }
        }
    }
}

pub(super) async fn process_text_retries(core: Arc<Core>, mut shutdown: watch::Receiver<bool>) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let (outcome, next) = {
            let mut database = core.database.lock().await;
            let outcome = maintain_execution_text(&mut database);
            (
                outcome,
                crate::execution_text::retry_deadline(&database)
                    .map(tokio::time::Instant::from_std),
            )
        };
        if let Some(error) = outcome.error {
            eprintln!("Execution text finalization remains pending: {error:#}");
        }
        for evidence in outcome.finalized {
            let method = evidence.event_type.clone();
            emit(
                &core.output,
                &method,
                json!({
                    "agentRunId": evidence.agent_run_id, "executionEpoch": evidence.execution_epoch,
                    "nativeMethod": "execution-text-maintenance", "evidenceId": evidence.id,
                    "revision": evidence.revision, "changeSequence": evidence.change_sequence,
                    "outputTruncated": evidence.output_truncated, "payload": evidence.payload, "canonical": evidence.canonical,
                }),
            );
        }
        if matches!(
            wait_for_wake(&core.execution_wake.text, next, &mut shutdown).await,
            Wake::Shutdown
        ) {
            break;
        }
    }
}

pub(super) async fn process_runtime_authorizations(
    core: Arc<Core>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut next = None;
    let mut scan = true;
    loop {
        if *shutdown.borrow() {
            break;
        }
        let mut retry = None;
        if scan {
            let result: Result<Option<chrono::DateTime<chrono::Utc>>> = async {
                // Keep deadlines that become due during dispatch. Using a new
                // timestamp for the reminder query would leave a coverage gap.
                let observed_through = chrono::Utc::now();
                core.dispatch_runtime_deliveries(&core.output).await?;
                let database = core.database.lock().await;
                ActionSafetyService::default()
                    .next_runtime_delivery_wake(&database, observed_through)
            }
            .await;
            match result {
                Ok(at) => next = at,
                Err(error) => {
                    eprintln!("Runtime authorization delivery deferred: {error:#}");
                    retry = Some(tokio::time::Instant::now() + DRIVER_RETRY_DELAY);
                }
            }
        }
        let deadline = retry.or_else(|| wall_reminder(next, chrono::Utc::now()));
        match wait_for_wake(&core.execution_wake.authorization, deadline, &mut shutdown).await {
            Wake::Shutdown => break,
            Wake::Changed => scan = true,
            Wake::Deadline => {
                scan = retry.is_some() || next.is_some_and(|at| at <= chrono::Utc::now())
            }
        }
    }
}

pub(super) struct RuntimeCleanupGuard {
    pub core: Arc<Core>,
    pub key: ActiveExecutionKey,
    pub completed: bool,
}

impl Drop for RuntimeCleanupGuard {
    fn drop(&mut self) {
        let mut attempts = self
            .core
            .agent_run_cleanup_inflight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.completed {
            attempts.remove(&self.key);
            self.core.execution_wake.runs.notify_one();
            self.core.delivery_batch_scheduler_notify.notify_one();
        } else {
            // Preserve the former cleanup retry cadence, only for a failed attempt.
            attempts.insert(
                self.key.clone(),
                Some(tokio::time::Instant::now() + Duration::from_millis(500)),
            );
        }
        self.core.agent_run_cancellation_notify.notify_one();
    }
}

pub(super) async fn process_runtime_cancellations(
    core: Arc<Core>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let deadline = match core.dispatch_agent_run_cancellations(&core.output).await {
            Ok(at) => at,
            Err(error) => {
                eprintln!("Runtime cleanup check deferred: {error:#}");
                Some(tokio::time::Instant::now() + DRIVER_RETRY_DELAY)
            }
        };
        if matches!(
            wait_for_wake(&core.agent_run_cancellation_notify, deadline, &mut shutdown).await,
            Wake::Shutdown
        ) {
            break;
        }
    }
}

pub(super) async fn process_housekeeping(
    core: Arc<Core>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let mut mcp_cleanup_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(30),
        Duration::from_secs(30),
    );
    mcp_cleanup_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut pending_execution_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(15),
        Duration::from_secs(15),
    );
    pending_execution_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut managed_blob_gc_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(60),
        Duration::from_secs(60),
    );
    managed_blob_gc_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut camp_deletion_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(1),
        Duration::from_secs(15),
    );
    camp_deletion_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        if *shutdown.borrow() {
            break;
        }
        {
            let mut tasks = core.agent_run_tasks.lock().await;
            while let Some(result) = tasks.try_join_next() {
                if let Err(error) = result {
                    eprintln!("tracked execution worker failed: {error}");
                }
            }
        }
        tokio::select! {
            _ = core.mission_workspace_cleanup_notify.notified() => {
                let cleanup_core=Arc::clone(&core);
                core.agent_run_tasks.lock().await.spawn(async move {
                    let _cleanup = cleanup_core.mission_workspace_cleanup_gate.lock().await;
                    if let Err(error)=cleanup_core.cleanup_mission_workspaces_locked(None).await {
                        eprintln!("Mission cleanup pending: {error:#}");
                    }
                });
            },
            _ = core.camp_deletion_notify.notified() => {
                let deletion_core = Arc::clone(&core);
                core.agent_run_tasks.lock().await.spawn(async move {
                    deletion_core.process_camp_deletions().await;
                });
            },
            _ = mcp_cleanup_interval.tick() => {
                core.cleanup_mcp_projections_best_effort().await;
                let cleanup_core=Arc::clone(&core);
                core.agent_run_tasks.lock().await.spawn(async move {
                    if let Ok(_cleanup)=cleanup_core.mission_workspace_cleanup_gate.try_lock()
                        && let Err(error)=cleanup_core.cleanup_mission_workspaces_locked(None).await {
                        eprintln!("Mission cleanup pending: {error:#}");
                    }
                });
            },
            _ = pending_execution_interval.tick() => {
                core.recover_pending_execution_intents().await;
                let projection_recovery = {
                    let mut database = core.database.lock().await;
                    AgentRunFileChangeProjector.recover_terminal_runs(
                        &mut database,
                        &ManagedBlobStore::new(&core.data_dir),
                    )
                };
                match projection_recovery {
                    Ok(recovered) if recovered > 0 => emit(
                        &core.output,
                        "agent_run.file_changes_completed",
                        json!({ "recovered": recovered }),
                    ),
                    Ok(_) => {}
                    Err(error) => eprintln!(
                        "AgentRun file-change projection recovery remains pending: {error:#}"
                    ),
                }
            },
            _ = managed_blob_gc_interval.tick() => {
                let cutoff = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
                let result = {
                    let mut database = core.database.lock().await;
                    ManagedBlobStore::new(&core.data_dir)
                        .collect_gc_candidates_before(&mut database, &cutoff, 32)
                };
                if let Err(error) = result {
                    eprintln!("Managed Blob candidate collection remains pending: {error:#}");
                }
            },
            _ = camp_deletion_interval.tick() => {
                let deletion_core = Arc::clone(&core);
                core.agent_run_tasks.lock().await.spawn(async move {
                    deletion_core.process_camp_deletions().await;
                });
            },
            _ = shutdown.changed() => break,
        }
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns the new wait seam: pre-wait commits, coalescing, independent consumers,
    // earlier deadlines and stop signals must all survive without a periodic tick.
    #[tokio::test(start_paused = true)]
    async fn notifications_survive_processing_and_wait_registration() {
        let hints = crate::execution_wake::ExecutionWake::default();
        let (stop, mut shutdown) = watch::channel(false);
        hints.execution_changed();
        hints.execution_changed();
        for notify in [
            &hints.runs,
            &hints.automation,
            &hints.cancellation,
            &hints.authorization,
            &hints.budgets,
            &hints.delivery,
        ] {
            assert!(matches!(
                wait_for_wake(notify, None, &mut shutdown).await,
                Wake::Changed
            ));
            assert!(
                tokio::time::timeout(Duration::ZERO, notify.notified())
                    .await
                    .is_err()
            );
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        {
            let waiting = wait_for_wake(&hints.automation, Some(deadline), &mut shutdown);
            tokio::pin!(waiting);
            assert!(
                std::future::Future::poll(
                    waiting.as_mut(),
                    &mut std::task::Context::from_waker(std::task::Waker::noop())
                )
                .is_pending()
            );
            hints.automation.notify_one();
            assert!(matches!(waiting.await, Wake::Changed));
        }
        let earlier = tokio::time::Instant::now() + Duration::from_secs(1);
        assert!(matches!(
            wait_for_wake(&hints.automation, Some(earlier), &mut shutdown).await,
            Wake::Deadline
        ));
        assert!(tokio::time::Instant::now() < deadline);
        // A notification arriving during processing is retained for the next wait.
        hints.automation.notify_one();
        assert!(matches!(
            wait_for_wake(&hints.automation, None, &mut shutdown).await,
            Wake::Changed
        ));
        stop.send(true).unwrap();
        hints.automation.notify_one();
        assert!(matches!(
            wait_for_wake(&hints.automation, None, &mut shutdown).await,
            Wake::Shutdown
        ));
    }

    // Owns the in-flight notification/completion interleaving. Poll the actual
    // coordinator on a current-thread runtime before allowing its preparation
    // to finish; Notify-only tests cannot observe a skipped in-flight Run.
    #[cfg(all(feature = "slow-tests", any(target_os = "macos", windows)))]
    #[tokio::test(start_paused = true)]
    async fn non_batch_preparation_rechecks_coalesced_wakes_once_without_spinning() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let root =
            std::env::temp_dir().join(format!("rovai-preparation-wake-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let core = Arc::new(super::super::tests::runtime_resolution_test_core(&root).unwrap());
        fn command<P>(id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
            CommandEnvelope {
                command_id: id.into(),
                actor: ActorRef::User {
                    user_id: "local-user".into(),
                },
                camp_id: camp_id.map(str::to_owned),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload,
            }
        }
        let run_id = {
            let mut database = core.database.lock().await;
            crate::agent_profile::configure_test_runtime(&database, &["agent_1"]);
            let created = CollaborationService::default()
                .create_camp(
                    &mut database,
                    &command(
                        "wake-camp",
                        None,
                        CreateThreadCommand::for_test(workspace.to_string_lossy().into()),
                    ),
                )
                .unwrap();
            let camp_id = created.result.payload["threadId"].as_str().unwrap();
            let opened = SingleChatService::default()
                .open(
                    &mut database,
                    &command(
                        "wake-open",
                        Some(camp_id),
                        OpenSingleChatCommand {
                            draft_client: Default::default(),
                            camp_id: camp_id.into(),
                            agent_id: "agent_1".into(),
                        },
                    ),
                )
                .unwrap();
            let conversation_id = opened.result.payload["conversationId"].as_str().unwrap();
            let draft_revision = database
                .connection()
                .query_row(
                    "SELECT revision FROM single_chat_composer_draft WHERE conversation_id=?1",
                    [conversation_id],
                    |row| row.get(0),
                )
                .unwrap();
            let sent = SingleChatService::default()
                .send(
                    &mut database,
                    &command(
                        "wake-send",
                        Some(camp_id),
                        SendSingleChatMessageCommand {
                            draft_client: Default::default(),
                            camp_id: camp_id.into(),
                            conversation_id: conversation_id.into(),
                            body: "Check after readiness changes".into(),
                            draft_revision,
                        },
                    ),
                )
                .unwrap();
            assert_eq!(sent.result.status, CommandResultStatus::Accepted);
            sent.result.payload["agentRunId"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        // Both gates start blocked. Later one becomes ready while the other
        // stays blocked, so the required recheck must not turn into busy retry.
        for subsystem in ["skills", "mcp"] {
            core.subsystems
                .finish(subsystem, Err(anyhow::anyhow!("initializing")));
        }
        // Consume setup's permit before starting the controlled interleaving.
        core.execution_wake.runs.notified().await;
        let operations = Arc::new(AtomicUsize::new(0));
        let count = operations.clone();
        core.database
            .lock()
            .await
            .connection()
            .progress_handler(
                1,
                Some(move || {
                    count.fetch_add(1, Ordering::SeqCst);
                    false
                }),
            )
            .unwrap();
        let (stop, shutdown) = watch::channel(false);
        let mut driver = Box::pin(process_non_batch_runs(core.clone(), shutdown));
        fn poll_pending(driver: std::pin::Pin<&mut impl std::future::Future<Output = ()>>) {
            assert!(
                std::future::Future::poll(
                    driver,
                    &mut std::task::Context::from_waker(std::task::Waker::noop()),
                )
                .is_pending()
            );
        }
        // The initial scan spawns one preparation and yields. No await between
        // these polls lets that task complete before the new wake is consumed.
        poll_pending(driver.as_mut());
        assert_eq!(core.agent_run_tasks.try_lock().unwrap().len(), 1);
        core.finish_subsystem("skills", Ok(()));
        core.execution_wake.runs.notify_one();
        core.execution_wake.runs.notify_one();
        poll_pending(driver.as_mut());
        assert_eq!(
            core.agent_run_tasks.try_lock().unwrap().len(),
            1,
            "a wake cannot start a second preparation for the in-flight Run"
        );
        {
            let mut tasks = core.agent_run_tasks.lock().await;
            tasks.join_next().await.unwrap().unwrap();
            assert!(tasks.is_empty());
        }
        assert!(core.non_batch_retry_at.try_lock().unwrap().is_none());
        // No further notification or deadline: completion must retain the
        // consumed wake even though the first preparation made no progress.
        poll_pending(driver.as_mut());
        assert_eq!(
            core.agent_run_tasks.try_lock().unwrap().len(),
            1,
            "a wake consumed during preparation must cause one recheck on completion"
        );
        {
            let mut tasks = core.agent_run_tasks.lock().await;
            tasks.join_next().await.unwrap().unwrap();
            assert!(tasks.is_empty());
        }
        poll_pending(driver.as_mut());
        assert!(
            core.agent_run_tasks.try_lock().unwrap().is_empty(),
            "completion without a new wake or progress must wait"
        );
        assert!(core.non_batch_retry_at.try_lock().unwrap().is_none());
        let idle_operations = operations.load(Ordering::SeqCst);
        tokio::time::advance(Duration::from_secs(60)).await;
        poll_pending(driver.as_mut());
        assert_eq!(
            operations.load(Ordering::SeqCst),
            idle_operations,
            "the blocked Run must not cause periodic or completion-driven scans"
        );
        let status: String = core
            .database
            .lock()
            .await
            .connection()
            .query_row(
                "SELECT status FROM agent_run WHERE id=?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "queued");
        stop.send(true).unwrap();
        driver.await;
        core.abort_agent_run_tasks().await;
        drop(core);
        std::fs::remove_dir_all(root).unwrap();
    }

    // The production drivers and SQLite VM counter are necessary here: a mock
    // Notify test cannot detect idle SQL scans or skipped-batch starvation.
    #[cfg(all(feature = "slow-tests", any(target_os = "macos", windows)))]
    #[tokio::test(start_paused = true)]
    async fn idle_drivers_do_not_scan_and_skipped_backlog_drains_without_ticks() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let root = std::env::temp_dir().join(format!("rovai-heartbeat-{}", uuid::Uuid::new_v4()));
        let core = Arc::new(super::super::tests::runtime_resolution_test_core(&root).unwrap());
        let operations = Arc::new(AtomicUsize::new(0));
        {
            let count = operations.clone();
            core.database
                .lock()
                .await
                .connection()
                .progress_handler(
                    1,
                    Some(move || {
                        count.fetch_add(1, Ordering::SeqCst);
                        false
                    }),
                )
                .unwrap();
        }
        async fn settle() {
            // Drain the finite notification chain between owners without advancing time.
            for _ in 0..64 {
                tokio::task::yield_now().await;
            }
        }
        let (stop, shutdown) = watch::channel(false);
        let mut workers = start_execution_workers(&core, shutdown);
        settle().await;
        tokio::time::advance(Duration::from_secs(2)).await;
        settle().await; // Includes the existing one-second startup Camp cleanup.
        assert!(
            operations.load(Ordering::SeqCst) > 0,
            "counter must observe real startup SQL"
        );
        let baseline = operations.load(Ordering::SeqCst);
        // Twenty former heartbeat opportunities; remaining housekeepers are not due.
        for _ in 0..20 {
            tokio::time::advance(Duration::from_millis(500)).await;
            settle().await;
        }
        assert_eq!(
            operations.load(Ordering::SeqCst),
            baseline,
            "idle drivers must execute zero SQL"
        );
        eprintln!(
            "[heartbeat-idle] observed_seconds=10 former_tick_opportunities=20 sqlite_vm_operations=0"
        );

        // Commit while every driver is waiting. 33 missed definitions yield no
        // dispatches, but require three batches and must all settle immediately.
        {
            use crate::automation::{AutomationSchedule, CreateAutomationCommand};
            let mut database = core.database.lock().await;
            let member = AgentProfileService::default()
                .list_profiles(&database)
                .unwrap()
                .remove(0)
                .agent_id;
            let due = chrono::Local::now() + chrono::Duration::days(1);
            for index in 0..33 {
                AutomationService::default()
                    .create(
                        &mut database,
                        &CommandEnvelope {
                            command_id: format!("driver-backlog-{index}"),
                            actor: ActorRef::User {
                                user_id: "local-user".into(),
                            },
                            camp_id: None,
                            expected_versions: Vec::new(),
                            execution_epoch: None,
                            payload: CreateAutomationCommand {
                                name: None,
                                prompt: "missed backlog".into(),
                                member_id: member.clone(),
                                project_ref: AutomationProjectRef::QuickChat,
                                schedule: AutomationSchedule::Once {
                                    date: due.format("%Y-%m-%d").to_string(),
                                    at: due.format("%H:%M").to_string(),
                                },
                                notify_channels: Vec::new(),
                            },
                        },
                    )
                    .unwrap();
            }
            database
                .connection()
                .execute(
                    "UPDATE automation SET next_run_at=?1",
                    [(chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339()],
                )
                .unwrap();
        }
        settle().await;
        {
            let database = core.database.lock().await;
            let skipped: i64 = database.connection().query_row(
                "SELECT COUNT(*) FROM automation_run WHERE status='skipped' AND reason='missed'", [], |row| row.get(0),
            ).unwrap();
            assert_eq!(
                skipped, 33,
                "all skipped batches must drain before any time advances"
            );
            assert_eq!(
                AutomationService::default()
                    .next_wake_at(&database, chrono::Utc::now())
                    .unwrap(),
                None
            );
        }
        let after_backlog = operations.load(Ordering::SeqCst);
        tokio::time::advance(Duration::from_millis(500)).await;
        settle().await;
        assert_eq!(operations.load(Ordering::SeqCst), after_backlog);
        core.execution_wake.execution_changed();
        core.execution_wake.execution_changed();
        settle().await;
        assert!(
            operations.load(Ordering::SeqCst) > after_backlog,
            "new facts wake every relevant owner"
        );
        let after_notice = operations.load(Ordering::SeqCst);
        tokio::time::advance(Duration::from_millis(500)).await;
        settle().await;
        assert_eq!(operations.load(Ordering::SeqCst), after_notice);
        // A transient read error must wait for its retry instead of repeatedly
        // hitting an expired deadline. Restore the reader before the one-shot fires.
        let probes = Arc::new(AtomicUsize::new(0));
        let deny = Arc::new(std::sync::atomic::AtomicBool::new(true));
        {
            let probes = probes.clone();
            let deny = deny.clone();
            core.database
                .lock()
                .await
                .connection()
                .authorizer(Some(move |context: rusqlite::hooks::AuthContext<'_>| {
                    if matches!(
                        context.action,
                        rusqlite::hooks::AuthAction::Read {
                            table_name: "automation",
                            column_name: "id",
                            ..
                        }
                    ) {
                        probes.fetch_add(1, Ordering::SeqCst);
                        if deny.load(Ordering::SeqCst) {
                            return rusqlite::hooks::Authorization::Deny;
                        }
                    }
                    rusqlite::hooks::Authorization::Allow
                }))
                .unwrap();
        }
        core.execution_wake.automation.notify_one();
        settle().await;
        assert_eq!(probes.load(Ordering::SeqCst), 1);
        tokio::time::advance(Duration::from_secs(1)).await;
        settle().await;
        assert_eq!(
            probes.load(Ordering::SeqCst),
            1,
            "failed reads must not busy-loop"
        );
        deny.store(false, Ordering::SeqCst);
        tokio::time::advance(Duration::from_secs(2)).await;
        settle().await;
        assert!(
            probes.load(Ordering::SeqCst) > 1,
            "the retry must resume without a new notification"
        );
        core.database
            .lock()
            .await
            .connection()
            .authorizer(
                None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>,
            )
            .unwrap();
        stop.send(true).unwrap();
        while let Some(result) = workers.join_next().await {
            result.unwrap();
        }
        core.abort_agent_run_tasks().await;
        let stopped = operations.load(Ordering::SeqCst);
        core.execution_wake.execution_changed();
        tokio::time::advance(Duration::from_secs(120)).await;
        settle().await;
        assert_eq!(
            operations.load(Ordering::SeqCst),
            stopped,
            "stopped drivers cannot write or scan"
        );

        // An active unbounded Turn must not arm even a clock-only budget reminder.
        // Keep the other workers stopped so their retained housekeeping is unrelated.
        let accepted_at = chrono::Utc::now();
        let camp_id = {
            let mut database = core.database.lock().await;
            let workspace = root.join("budget-workspace");
            std::fs::create_dir_all(&workspace).unwrap();
            let created = CollaborationService::default()
                .create_camp(
                    &mut database,
                    &CommandEnvelope {
                        command_id: "unbounded-budget-camp".into(),
                        actor: ActorRef::User {
                            user_id: "local-user".into(),
                        },
                        camp_id: None,
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: CreateThreadCommand::for_test(workspace.to_string_lossy().into()),
                    },
                )
                .unwrap();
            created.result.payload["threadId"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let unbounded =
            crate::execution_budget::freeze_camp_turn_execution_budget(None, accepted_at, 1)
                .unwrap();
        {
            let database = core.database.lock().await;
            database.connection().execute(
                "INSERT INTO camp_turn(id,camp_id,trigger_type,trigger_id,status,created_at,updated_at,
                 execution_budget_schema_version,execution_budget_accepted_at,execution_budget_deadline_at,
                 execution_budget_elapsed_seconds,execution_budget_max_agent_run_responsibilities,
                 execution_budget_max_accepted_a2a,execution_budget_root_agent_run_responsibilities)
                 VALUES ('unbounded-budget-turn',?1,'camp_message','budget-test','running',?2,?2,?3,?2,?4,?5,?6,?7,1)",
                rusqlite::params![camp_id, unbounded.accepted_at, unbounded.schema_version, unbounded.deadline_at,
                    unbounded.elapsed_seconds, unbounded.max_agent_run_responsibilities, unbounded.max_accepted_a2a],
            ).unwrap();
        }
        let (budget_stop, shutdown) = watch::channel(false);
        let polls = Arc::new(AtomicUsize::new(0));
        let poll_count = polls.clone();
        let budget_core = core.clone();
        let budget_worker = tokio::spawn(async move {
            let mut driver = Box::pin(process_execution_budgets(budget_core, shutdown));
            std::future::poll_fn(|context| {
                poll_count.fetch_add(1, Ordering::SeqCst);
                std::future::Future::poll(driver.as_mut(), context)
            })
            .await
        });
        settle().await;
        let before = (
            polls.load(Ordering::SeqCst),
            operations.load(Ordering::SeqCst),
        );
        tokio::time::advance(Duration::from_secs(172_800)).await;
        settle().await;
        assert_eq!(
            (
                polls.load(Ordering::SeqCst),
                operations.load(Ordering::SeqCst)
            ),
            before,
            "without a finite deadline, two days must cause no budget wake or SQL"
        );
        budget_stop.send(true).unwrap();
        budget_worker.await.unwrap();

        drop(core);
        std::fs::remove_dir_all(root).unwrap();
    }
}
