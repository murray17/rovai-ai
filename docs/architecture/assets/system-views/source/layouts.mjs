// Each registered figure maps to one editable vector layout.
import { renderSystemOverview } from './system-overview.mjs';
import { renderIdentityRuntime, renderConversationRuns } from './member-execution.mjs';
import { renderA2AComic, renderOrganizationComic } from './collaboration-comics.mjs';
import { renderToolkitArchitecture, renderTechnologyStack } from './toolkit-stack.mjs';
import { renderLayeredContext, renderSessionComic, renderMemoryStudio } from './context-memory.mjs';

import { renderRunLifecycle } from './run-lifecycle.mjs';

const layouts = {
  '01-collaboration': renderSystemOverview,
  '02-identity-runtime': renderIdentityRuntime,
  '03-conversation-runs': renderConversationRuns,
  '04-a2a-handoff': renderA2AComic,
  '05-gather': renderOrganizationComic,
  '06-run-lifecycle': renderRunLifecycle,
  '07-toolkit': renderToolkitArchitecture,
  '08-dynamic-context': renderLayeredContext,
  '09-session-context': renderSessionComic,
  '10-memory-governance': renderMemoryStudio,
  '11-technology-stack': renderTechnologyStack,
};

export function renderLayout(id) {
  const draw = layouts[id];
  if (!draw) throw new Error(`No SVG layout for ${id}`);
  return draw();
}
