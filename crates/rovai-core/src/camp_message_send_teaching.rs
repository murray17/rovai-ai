pub const CAMP_MESSAGE_SEND_SUMMARY: &str = "Publish one public Thread message. Use --public-only when the message must not address any Agent; it prevents Agent addressing, creates no Agent Delivery, and wakes no Agent. Without --public-only, --to may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the User. Use --to-user only for a new unresolved User decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.";

pub const CAMP_MESSAGE_SEND_FILE_HELP: &str = "Attach a recipient-facing file or directory at its actual path; repeat to preserve attachment order. Rovai references the current file without copying or changing permissions. Temporary files may become unavailable when their source is cleaned up.";

pub const CAMP_MESSAGE_SEND_INPUT_HELP: &str =
    "Input: direct flags, or --input-file <path> with send flags except --body.";

pub const CAMP_MESSAGE_SEND_BODY_HELP: &str = "Use --body for simple single-line text; \\n remains literal.\n\
     For multiline, Markdown, or complex text, use a file-write tool to write the reply text itself, with real newlines, to a UTF-8 file.";

pub const CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION: &str = "Guarantee that this public Thread message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because User attention is not Agent routing.";

pub const CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION: &str = "Mention the User and create an Inbox notification. Ordinary public Thread messages are already visible to the User. Use this only when the message creates a new unresolved decision, answer, or action for the User, or when the User explicitly requested notification of an important result. It creates no Agent Delivery, does not represent approval, and may be combined with publicOnly. User attention is message-local and is never inherited.";

pub const CAMP_MESSAGE_SEND_TO_HELP: &str = "Explicit Agent recipient to wake; repeat as needed.
Agent addressing schedules concrete continuing work, not CC.
Do not use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or a repeated conclusion.
This option is invalid with --public-only.";

pub const CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP: &str =
    "Guarantee that this public message wakes no Agent.

effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

Do not combine this option with --to or --task-id. It may be combined with --to-user.";

pub const CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP: &str = "Mention the User and create an Inbox notification.

Ordinary public Thread messages are already visible to the User. Use this flag only when the message creates a new unresolved decision, answer, or action for the User, or when the User explicitly requested notification of an important result.

It creates no Agent Delivery, does not represent approval, and may be combined with --public-only. User attention is message-local and is never inherited by replies, Tasks, or downstream A2A work.";

pub const CAMP_MESSAGE_SEND_HELP_EXAMPLES: [&str; 3] = [
    "Write reply.md:\n  Result:\n\n  Updated `src/example.rs`.\nAfter the write succeeds:\n  rovai send --public-only --input-file reply.md",
    "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
    "rovai send --public-only --to-user --body 'Please choose whether to roll back the client or continue the token investigation.'",
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
            assert!(text.contains("User"));
        }
        assert!(CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION.contains("never inherited"));
        assert!(CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP.contains("message-local"));
        assert!(CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP.contains("does not represent approval"));
    }

    #[test]
    fn agent_routing_teaching_exposes_intent_and_postcondition() {
        assert_eq!(
            CAMP_MESSAGE_SEND_SUMMARY,
            "Publish one public Thread message. Use --public-only when the message must not address any Agent; it prevents Agent addressing, creates no Agent Delivery, and wakes no Agent. Without --public-only, --to may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the User. Use --to-user only for a new unresolved User decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed."
        );
        assert_eq!(
            CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION,
            "Guarantee that this public Thread message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because User attention is not Agent routing."
        );
        assert_eq!(
            CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP,
            "Guarantee that this public message wakes no Agent.\n\neffectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.\n\nDo not combine this option with --to or --task-id. It may be combined with --to-user."
        );
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("concrete continuing work, not CC"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("never use it for acknowledgement"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("agentAddressingMode"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("effectiveRecipients"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("deliveryIds"));
        assert!(!CAMP_MESSAGE_SEND_SUMMARY.contains("--file"));
        assert!(!CAMP_MESSAGE_SEND_SUMMARY.contains("snapshot"));
        for hidden_fallback_term in ["inline", "Agent-like @text"] {
            assert!(!CAMP_MESSAGE_SEND_SUMMARY.contains(hidden_fallback_term));
            assert!(
                !CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION.contains(hidden_fallback_term)
            );
            assert!(!CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP.contains(hidden_fallback_term));
        }
        assert_eq!(
            CAMP_MESSAGE_SEND_FILE_HELP,
            "Attach a recipient-facing file or directory at its actual path; repeat to preserve attachment order. Rovai references the current file without copying or changing permissions. Temporary files may become unavailable when their source is cleaned up."
        );
    }

    #[test]
    fn examples_keep_public_agent_and_principal_attention_separate() {
        assert_eq!(CAMP_MESSAGE_SEND_HELP_EXAMPLES.len(), 3);
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[0].contains("--input-file reply.md"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[0].contains("--public-only"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[1].contains("--to agent_5"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[1].contains("--to-user"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--public-only"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--to-user"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--to agent_5"));
        assert!(
            CAMP_MESSAGE_SEND_HELP_EXAMPLES
                .iter()
                .all(|example| !example.contains("--file"))
        );
    }
}
