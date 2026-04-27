import { buildResourceCommand } from "./resource.js";

export function buildPhoneNumberCommand() {
  return buildResourceCommand({
    name: "phone-number",
    apiPath: "phone-number",
    description:
      "Manage Vapi phone numbers (the link between assistants/squads and inbound calls)",
  });
}
