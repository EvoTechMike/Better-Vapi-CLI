import { buildResourceCommand } from "./resource.js";

export function buildSquadCommand() {
  return buildResourceCommand({
    name: "squad",
    apiPath: "squad",
    description: "Manage Vapi squads (multi-assistant routing)",
  });
}
