import { buildResourceCommand } from "./resource.js";

export function buildCallCommand() {
  return buildResourceCommand({
    name: "call",
    apiPath: "call",
    description: "Inspect and filter Vapi call logs",
    listQueryFlags: [
      { flag: "--id <id>", description: "Filter to a single call id", query: "id" },
      {
        flag: "--assistant-id <id>",
        description: "Filter by assistant id",
        query: "assistantId",
      },
      {
        flag: "--phone-number-id <id>",
        description: "Filter by phone number id",
        query: "phoneNumberId",
      },
    ],
  });
}
