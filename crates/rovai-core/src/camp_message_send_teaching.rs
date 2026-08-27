pub const CAMP_MESSAGE_SEND_SUMMARY: &str = "Publish one public Camp message. Repeat --file to attach ordered immutable Camp attachments; at least one file can be the complete payload when no body is needed, and no separate upload is required. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.";

pub const CAMP_MESSAGE_SEND_FILE_HELP: &str = "Attach a local file to this Camp message as an immutable Camp attachment; repeat as needed.\n\nAt least one file is a complete payload, so --body may be omitted for an attachment-only message. Files appear after any message body in flag order. No separate upload command is required.";

pub const CAMP_MESSAGE_SEND_BODY_HELP: &str = "For multiline Markdown, pass real newline characters.\nDirect --body values are literal: \\n inside ordinary shell quotes is text, not a line break.\nJSON stdin/heredoc and JSON --input-file decode \\n escapes.";

pub const CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION: &str = "Guarantee that this public Camp message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, restricted inline Agent addressing is not parsed, Agent-like @text remains ordinary text, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because Principal attention is not Agent routing.";

pub const CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION: &str = "Mention the Principal and create an Inbox notification. Ordinary public Camp messages are already visible to the Principal. Use this only when the message creates a new unresolved decision, answer, or action for the Principal, or when the Principal explicitly requested notification of an important result. It creates no Agent Delivery, does not represent approval, and may be combined with publicOnly. Principal attention is message-local and is never inherited.";

pub const CAMP_MESSAGE_SEND_TO_HELP: &str = "Explicit Agent recipient to wake; repeat as needed.
Agent addressing schedules concrete continuing work, not CC.
Do not use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or a repeated conclusion.
This option is invalid with --public-only.";

pub const CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP: &str = "Guarantee that this public message wakes no Agent.

Restricted inline Agent addressing is disabled, Agent-like @text remains ordinary text, effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

Do not combine this option with --to or --task-id. It may be combined with --to-principal.";

pub const CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP: &str = "Mention the Principal and create an Inbox notification.

Ordinary public Camp messages are already visible to the Principal. Use this flag only when the message creates a new unresolved decision, answer, or action for the Principal, or when the Principal explicitly requested notification of an important result.

It creates no Agent Delivery, does not represent approval, and may be combined with --public-only. Principal attention is message-local and is never inherited by replies, Tasks, or downstream A2A work.";

pub const CAMP_MESSAGE_SEND_HELP_EXAMPLES: [&str; 4] = [
    "rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'",
    "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
    "rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'",
    "rovai send --file \"$ROVAI_RUN_TMP/report.pdf\"",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn principal_attention_teaching_is_message_local_and_not_agent_routing() {
        for text in [
            CAMP_MESSAGE_SEND_SUMMARY,
            CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION,
            CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION,
            CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP,
        ] {
            assert!(text.contains("Principal"));
        }
        assert!(CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION.contains("never inherited"));
        assert!(CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP.contains("message-local"));
        assert!(CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP.contains("does not represent approval"));
    }

    #[test]
    fn agent_routing_teaching_exposes_intent_and_postcondition() {
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("restricted inline Agent addressing"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("concrete continuing work, not CC"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("never use it for acknowledgement"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("agentAddressingMode"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("effectiveRecipients"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("deliveryIds"));
    }

    #[test]
    fn examples_keep_public_agent_and_principal_attention_separate() {
        assert_eq!(CAMP_MESSAGE_SEND_HELP_EXAMPLES.len(), 4);
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[0].contains("--public-only"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[1].contains("--to agent_5"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[1].contains("--to-principal"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--public-only"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--to-principal"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--to agent_5"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[3].contains("--file"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[3].contains("--body"));
    }
}
