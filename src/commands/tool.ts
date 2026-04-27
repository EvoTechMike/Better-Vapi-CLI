import { buildResourceCommand } from "./resource.js";

export function buildToolCommand() {
  return buildResourceCommand({
    name: "tool",
    apiPath: "tool",
    description:
      "Manage Vapi tools (function schemas, transferCall destinations, apiRequest tools)",
  });
}
