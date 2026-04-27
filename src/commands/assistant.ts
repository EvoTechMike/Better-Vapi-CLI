import { buildResourceCommand } from "./resource.js";

export function buildAssistantCommand() {
  return buildResourceCommand({
    name: "assistant",
    apiPath: "assistant",
    description: "Manage Vapi assistants",
  });
}
