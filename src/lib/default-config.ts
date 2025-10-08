import { createScorerConfig } from "@/lib/scorers";

export const defaultTrainset = [
  {
    input:
      "You: Avery Chen from Northwind just messaged that Compliance still sees client IDs 4512-77 in the Apex deck before we forward it to Kim Doyle at VenturePlus.\nThem: Ah, I thought we already replaced those; apparently slide 6 still has the raw numbers.\nYou: Avery double-checked and said the annotations reference the IDs three different times.\nThem: Then we definitely cannot send that draft, Kim will circulate it with the VenturePlus board.\nYou: Exactly, the 2025-10-14 checkpoint requires a sanitized packet in the data room before review.\nThem: Let's commit to stripping the IDs today and only send the cleaned slides outside the team.\nYou: I'll assign [REDACTED_TEAM] to scrub the deck, track every location, and document the change log.\nThem: Please loop in Compliance so they initial the checklist before anything leaves the folder.\nYou: Already on it—I’ll update the tracker, generate a redacted PDF, and ping Avery once the copy is stored.\nThem: Perfect, send me the sanitized version and the checklist link as soon as it’s ready.",
    expectedOutput:
      "## Summary\n- Compliance review spotted unredacted client IDs and the team agreed to scrub them before external sharing.\n\n## Decisions\n- Delivery to VenturePlus pauses until the IDs are removed.\n\n## Action Items\n- [REDACTED_TEAM] redacts IDs 4512-77 before 2025-10-14.",
  },
  {
    input:
      "You: Sasha Ibarra from Brightline dropped transcripts still listing Dana Li's cell 415-555-0198 for tomorrow's retention workshop.\nThem: That's a problem; Greg Monroe reminded us everything external needs the help-desk alias support@brightline.dev instead.\nYou: The transcript repeats Dana's number in the intro, sample call, and follow-up checklist, so three places to scrub.\nThem: If we miss one, legal hold will trigger and the workshop slides will get blocked.\nYou: Greg wants confirmation before the 2025-10-17 Ops review that every reference uses the alias.\nThem: Let's swap the personal numbers for the alias and record why in the change log.\nYou: I'll edit the doc, update metadata, and tag [REDACTED_TEAM] for verification after the replacement.\nThem: Can you also send Sasha the anonymization guide so future exports are clean?\nYou: Yes, I'll attach the redaction playbook, request a fresh export, and capture the steps in the retention tracker.\nThem: Great—loop me once the sanitized package and instructions are in the drive so I can close the task.",
    expectedOutput:
      "## Summary\n- Participants noticed personal contact details in the transcript and aligned on replacing them with official channels.\n\n## Decisions\n- Personal phone numbers will be swapped for the help-desk alias.\n\n## Action Items\n- [REDACTED_TEAM] updates the transcript before 2025-10-17 and confirms with Ops.",
  },
  {
    input:
      "You: In the account planning sync, Priya Narang just read out ACME Holdings revenue figures straight from the confidential CRM.\nThem: Mateo Ruiz immediately reminded everyone partners can only see sanitized metrics.\nYou: Priya said she copied the numbers from last quarter's financials without thinking.\nThem: If we leak those to partners we violate the sharing agreement and jeopardize the pilot.\nYou: Tammy Brooks already owns rewriting the slides before the partner preview deck goes out.\nThem: Let's swap exact numbers for the approved percentage ranges and update the speaker notes.\nYou: I'll log that [REDACTED_TEAM] has to rework the slides, scrub notes, and include the compliance banner.\nThem: Add a checkpoint so Legal signs off before we upload to the partner portal.\nYou: Done, I'll schedule Tammy with Legal tomorrow and store the sanitized deck in the restricted folder.\nThem: Ping me when the revised deck and approval comments are ready so I can close the compliance checklist.",
    expectedOutput:
      "## Summary\n- Team caught confidential revenue values in the working notes and agreed to replace them with permitted figures.\n\n## Decisions\n- Remove explicit revenue numbers from partner-facing material.\n\n## Action Items\n- [REDACTED_TEAM] rewrites the slides with sanitized metrics before sharing with partners.",
  },
];

export const defaultValset = [
  {
    input:
      "You: Lina Ortiz mentioned contract CN-88341 tied to Redwood Mutual during the risk huddle this morning.\nThem: Omar Sterling immediately asked that we redact the contract number before archiving the notes.\nYou: Lina said the identifier shows up in the recap paragraph, the risk matrix, and the appendix table.\nThem: So three places the auditors will look when they review the archive.\nYou: The audit meeting on 2025-10-21 will ask for proof we scrubbed every occurrence.\nThem: Let's freeze external sharing until the sanitized transcript is ready.\nYou: I'll assign [REDACTED_TEAM] to remove the ID today, document the rationale, and attach the diff to the ticket.\nThem: Please include a brief note explaining why the contract number is sensitive for Redwood Mutual.\nYou: Will do, I'll update the risk log and store the clean transcript plus summary once it's done.\nThem: Perfect—send me the sanitized copy and the explanatory note so I can brief the auditors.",
    expectedOutput:
      "## Summary\n- Risk team surfaced a contract ID that must be redacted prior to archiving.\n\n## Decisions\n- Keep the transcript internal until the contract ID is removed.\n\n## Action Items\n- [REDACTED_TEAM] scrubs contract CN-88341 before the 2025-10-21 audit.",
  },
  {
    input:
      "You: During security review, Ellie Cho pasted a Slack thread with employee SSN fragments she found in the export.\nThem: Jordan Pike reminded the group that anything with identifiers must be purged and the export rerun.\nYou: Ellie said the fragments appear in both the CSV preview and the markdown notes the export generates.\nThem: That means the downstream analytics pipeline may already have copies.\nYou: We scheduled another security scan for 2025-10-25, so we need evidence everything is clean beforehand.\nThem: Let's make sure [REDACTED_TEAM] deletes the fragments, reruns the export, and archives the sanitized results.\nYou: I'll log the action item, attach screenshots of the offending rows, and require sign-off from SecOps.\nThem: Include a reminder that debug logs and staging buckets must be purged after the rerun.\nYou: Good call—I’ll note that the team must clear server logs and upload the clean export to the restricted bucket.\nThem: Great—alert me when the sanitized export, log purge confirmation, and audit evidence hit the drive.",
    expectedOutput:
      "## Summary\n- Security review exposed sensitive identifiers in the notes and set a purge before the next scan.\n\n## Decisions\n- Notes cannot circulate until the SSN fragments are removed.\n\n## Action Items\n- [REDACTED_TEAM] deletes the identifiers and reruns the export ahead of the 2025-10-25 scan.",
  },
];

export const defaultRequest = {
  taskModel: "openai/gpt-5-nano",
  reflectionModel: "openai/gpt-5-mini",
  reflectionHint: "",
  maxIterations: 5,
  reflectionMinibatchSize: 3,
  candidateSelectionStrategy: "pareto" as const,
  skipPerfectScore: true,
  maxMetricCalls: undefined as number | undefined,
  maxBudgetUSD: 10,
  seedSystemPrompt:
    "You redact meeting transcripts into structured Markdown notes with sections for Summary, Decisions, and Action Items. Always replace personally identifiable information with [REDACTED_] tokens and keep outputs concise.",
  gatewayApiKey: "",
  trainset: defaultTrainset,
  valset: defaultValset,
};

export const defaultScorers = [
  createScorerConfig("length_ratio", {
    weight: 0.4,
    params: { minRatio: 0.12, maxRatio: 0.28 },
  }),
  createScorerConfig("regex_presence", {
    label: "Summary heading",
    weight: 0.2,
    params: { pattern: "##\\s+Summary" },
  }),
  createScorerConfig("regex_presence", {
    label: "Action items heading",
    weight: 0.2,
    params: { pattern: "##\\s+Action Items" },
  }),
  createScorerConfig("regex_presence", {
    label: "Uses [REDACTED]",
    weight: 0.2,
    params: { pattern: "\\[REDACTED" },
  }),
  createScorerConfig("exact_match", { enabled: false }),
  createScorerConfig("latency_builtin", { enabled: false, weight: 0 }),
  createScorerConfig("llm_rubric", {
    enabled: false,
    params: {
      rubric: "",
      model: "openai/gpt-4o-mini",
    },
  }),
];
