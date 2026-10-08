//! Process-local hints. Each Notify has one consumer; durable state still authorizes work.
use std::sync::Arc;
use tokio::sync::Notify;

#[derive(Clone, Default)]
pub(crate) struct ExecutionWake {
    pub delivery: Arc<Notify>,
    pub runs: Arc<Notify>,
    pub automation: Arc<Notify>,
    pub cancellation: Arc<Notify>,
    pub authorization: Arc<Notify>,
    pub budgets: Arc<Notify>,
    pub text: Arc<Notify>,
}

impl ExecutionWake {
    pub fn execution_changed(&self) {
        self.delivery.notify_one();
        self.runs.notify_one();
        self.automation.notify_one();
        self.cancellation.notify_one();
        self.authorization.notify_one();
        self.budgets.notify_one();
    }

    pub fn command_committed(&self, command: &str) {
        if command.starts_with("automation.") || command == "channel_delivery.settle" {
            self.automation.notify_one();
        } else if command.starts_with("action.")
            || command.starts_with("runtime_delivery.")
            || command.starts_with("runtime_request.")
        {
            self.automation.notify_one();
            self.authorization.notify_one();
        } else if command.starts_with("single_chat.")
            || command.starts_with("agent_run.")
            || command.starts_with("camp_turn.")
            || command.starts_with("camp.")
            || command.starts_with("conversation.")
            || command.starts_with("agent_profile.")
            || command.starts_with("adapter_installation.")
            || command.starts_with("runtime_loss.")
            || command == "channel_agent_run.cancel"
            || command == crate::message_delivery::CAMP_MESSAGE_SEND_TOOL_NAME
            || command == "camp_message.withdraw"
            || command == "skill.projections.reconcile"
        {
            self.execution_changed();
        }
    }
}
