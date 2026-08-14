pub const CAMP_MESSAGE_SEND_SUMMARY: &str = "Publish one public Camp message. Ordinary Camp messages are already visible to the user. Use --to agent_N or canonical inline @agent_N for stable Agent routing; an exact active Camp member @display-name followed by whitespace or end-of-body is also accepted. Use --to-user only for a new unresolved user decision, answer, or action, or an explicitly requested important-result notification. Omit addressing for a public-only update. Always inspect effectiveRecipients; [] means no Agent was routed.";

pub const CAMP_MESSAGE_SEND_TO_USER_SCHEMA_DESCRIPTION: &str = "Escalate this public CampMessage to current-user attention by creating a Current User Mention and Inbox notification. Ordinary Camp messages are already visible to the user. Set true only when this message creates a new unresolved user decision, answer, or action, or fulfills an explicit request for notification of an important asynchronous result. Do not inherit it from prior messages and do not use it for internal Agent routing, review handoffs, routine progress, acknowledgements, or ordinary final replies. Creates no Agent Delivery and does not represent user approval.";

pub const CAMP_MESSAGE_SEND_TO_USER_HELP: &str = "Mention the current user and create an Inbox notification.

Ordinary Camp messages are already visible to the user. Use this flag only when this message creates a new unresolved user decision, answer, or action, or when the user explicitly requested attention for an important asynchronous result.

Do not use it for internal Agent routing, review handoffs, routine progress, acknowledgements, ordinary final replies, or merely because an earlier message mentioned the user.

User attention is message-local and is never inherited by replies, Tasks, or downstream A2A work. It creates no Agent Delivery and does not represent user approval.";

pub const CAMP_MESSAGE_SEND_HELP_EXAMPLES: [&str; 3] = [
    "rovai send --body 'Status update'",
    "rovai send --to agent_5 --body 'Please review and report back'",
    "rovai send --to-user --body 'Please choose A or B'",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_attention_teaching_keeps_one_message_local_predicate() {
        for text in [
            CAMP_MESSAGE_SEND_SUMMARY,
            CAMP_MESSAGE_SEND_TO_USER_SCHEMA_DESCRIPTION,
            CAMP_MESSAGE_SEND_TO_USER_HELP,
        ] {
            assert!(text.contains("new unresolved user decision, answer, or action"));
        }
        assert!(CAMP_MESSAGE_SEND_TO_USER_SCHEMA_DESCRIPTION.contains("Do not inherit"));
        assert!(CAMP_MESSAGE_SEND_TO_USER_HELP.contains("message-local"));
        assert!(CAMP_MESSAGE_SEND_TO_USER_HELP.contains("does not represent user approval"));
    }

    #[test]
    fn agent_routing_teaching_exposes_exact_display_name_alias_and_postcondition() {
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("exact active Camp member @display-name"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("whitespace or end-of-body"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("inspect effectiveRecipients"));
        assert!(CAMP_MESSAGE_SEND_SUMMARY.contains("[] means no Agent was routed"));
    }

    #[test]
    fn base_examples_keep_public_agent_and_user_attention_separate() {
        assert_eq!(CAMP_MESSAGE_SEND_HELP_EXAMPLES.len(), 3);
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[0].contains("--to"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[1].contains("--to agent_5"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[1].contains("--to-user"));
        assert!(CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--to-user"));
        assert!(!CAMP_MESSAGE_SEND_HELP_EXAMPLES[2].contains("--to agent_5"));
    }
}
