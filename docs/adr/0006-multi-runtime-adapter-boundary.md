---
status: accepted
version: v0.03
---

# Use AgentRuntimeAdapter as the multi-runtime boundary

Lumen Core depends on one `AgentRuntimeAdapter` contract, with built-in Codex CLI, OpenCode CLI, Copilot CLI, and AGY CLI implementations. Process and connection reuse belongs to the internal `AgentRuntimeHostManager`, while App Server, ACP, and CLI process clients remain implementation details of their adapters; this avoids forcing unlike runtimes into one host topology or exposing protocol-specific behavior to the domain.

Lumen will not add a second public `AgentAdapter` abstraction or a dynamic plugin ABI in v0.03. Shared protocol code such as ACP may be reused internally without merging product-specific adapters or their capability declarations.

Detected `AdapterInstallation` records are application-level resources shared by AgentProfiles. Member-specific model preferences reference an installation without owning its executable, authentication state, capability catalog, or lifecycle.
