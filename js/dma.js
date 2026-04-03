/**
 * Double Materiality Assessment (DMA) — top-down per amended ESRS 1 AR 17.
 * ESRS 2 general disclosures + ESRS E1 climate (draft ESRS 2.0 scope).
 */

import OpenAI from "openai";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/**
 * @typedef {{
 *   ref: string,
 *   title: string,
 *   standard: string,
 *   mandatory: boolean,
 *   id?: string,
 *   omitted?: boolean,
 *   omissionReason?: string,
 *   omissionJustification?: string,
 * }} DrRow
 */

const OMISSION_REASON_OPTIONS = [
  "Phase-in provision (Appendix D, amended ESRS 1)",
  "Undue cost or effort",
  "Other",
];

const ESRS_TOPICS = [
  { code: "E1", name: "Climate change", interactive: true },
  { code: "E2", name: "Pollution", interactive: false },
  { code: "E3", name: "Water and marine resources", interactive: false },
  { code: "E4", name: "Biodiversity and ecosystems", interactive: false },
  { code: "E5", name: "Resource use and circular economy", interactive: false },
  { code: "S1", name: "Own workforce", interactive: false },
  { code: "S2", name: "Workers in the value chain", interactive: false },
  { code: "S3", name: "Affected communities", interactive: false },
  { code: "S4", name: "Consumers and end-users", interactive: false },
];

const E1_SUB_KEYS = [
  { key: "mitigation", label: "Climate change mitigation" },
  { key: "adaptation", label: "Climate change adaptation" },
  { key: "energy", label: "Energy" },
];

/** Stored in topic_assessments JSON for "Requires further assessment" (E1 topic and sub-topics). */
const E1_REQUIRES_FURTHER_ASSESSMENT = "requires_further_assessment";

/**
 * Parent E1 is Material or Requires further assessment but all three sub-topics
 * are explicitly Not material — invalid for Step 2 (must clear subs or fix selections).
 * @param {any} e1
 */
function isE1AllSubtopicsExplicitlyNotMaterial(e1) {
  if (
    !e1 ||
    (e1.level !== "material" && e1.level !== E1_REQUIRES_FURTHER_ASSESSMENT)
  ) {
    return false;
  }
  const s = e1.subtopics || {};
  return (
    s.mitigation === "not_material" &&
    s.adaptation === "not_material" &&
    s.energy === "not_material"
  );
}

const E1_TOPIC_DISPLAY_NAME = "Climate change";

function topicE1MaterialityLabel(level) {
  if (level === "material") return "Material";
  if (level === "not_material") return "Not material";
  if (level === E1_REQUIRES_FURTHER_ASSESSMENT) return "Requires further assessment";
  return "";
}

/** Explicit selection or inherited from E1 topic level when sub-topic is blank. */
function effectiveSubtopicValue(sub, e1, k) {
  const v = sub[k];
  if (
    v === "material" ||
    v === "not_material" ||
    v === E1_REQUIRES_FURTHER_ASSESSMENT
  ) {
    return v;
  }
  return e1.level ?? null;
}

function effectiveSubtopicIncludesDr(sub, e1, k) {
  const v = effectiveSubtopicValue(sub, e1, k);
  return v === "material" || v === E1_REQUIRES_FURTHER_ASSESSMENT;
}

function effectiveSubtopicDisplayLabel(sub, e1, k) {
  const v = effectiveSubtopicValue(sub, e1, k);
  if (v === "material") return "Material";
  if (v === "not_material") return "Not material";
  if (v === E1_REQUIRES_FURTHER_ASSESSMENT) return "Requires further assessment";
  return "";
}

const ESRS2_DR_TOPIC_LABEL = "ESRS 2 General";

/**
 * Read-only Step 4 table columns (derived from topic screening).
 * @param {string} ref
 * @param {string} standard
 * @param {Record<string, any>} topicAssessments
 * @returns {{ topic: string, subtopic: string, materiality: string }}
 */
function drRowTableColumns(ref, standard, topicAssessments) {
  if (standard === "ESRS 2") {
    return {
      topic: ESRS2_DR_TOPIC_LABEL,
      subtopic: "",
      materiality: "All undertakings",
    };
  }
  if (standard !== "ESRS E1") {
    return { topic: "", subtopic: "", materiality: "" };
  }
  const e1 = topicAssessments?.E1;
  if (!e1 || e1.level === "not_material") {
    return { topic: E1_TOPIC_DISPLAY_NAME, subtopic: "", materiality: "" };
  }
  const sub = e1.subtopics || {};
  const expanded = !!e1.subExpanded;
  const subKeyList = E1_SUB_KEYS.map((x) => x.key);
  const hasGranular =
    expanded &&
    subKeyList.some(
      (k) =>
        sub[k] === "material" ||
        sub[k] === "not_material" ||
        sub[k] === E1_REQUIRES_FURTHER_ASSESSMENT
    );

  if (!hasGranular) {
    return {
      topic: E1_TOPIC_DISPLAY_NAME,
      subtopic:
        ref === "E1-8" ? "Climate change mitigation · Energy" : "",
      materiality: topicE1MaterialityLabel(e1.level),
    };
  }

  const subsForRef = [];
  if (
    [
      "E1-1",
      "E1-4",
      "E1-5",
      "E1-6",
      "E1-8",
      "E1-9",
      "E1-10",
    ].includes(ref) &&
    effectiveSubtopicIncludesDr(sub, e1, "mitigation")
  ) {
    subsForRef.push("mitigation");
  }
  if (
    ["E1-2", "E1-3", "E1-11"].includes(ref) &&
    effectiveSubtopicIncludesDr(sub, e1, "adaptation")
  ) {
    subsForRef.push("adaptation");
  }
  if (
    ["E1-7", "E1-8"].includes(ref) &&
    effectiveSubtopicIncludesDr(sub, e1, "energy")
  ) {
    subsForRef.push("energy");
  }

  const subLabels = subsForRef.map(
    (k) => E1_SUB_KEYS.find((s) => s.key === k)?.label || k
  );
  const matLabels = subsForRef.map((k) =>
    effectiveSubtopicDisplayLabel(sub, e1, k)
  );

  return {
    topic: E1_TOPIC_DISPLAY_NAME,
    subtopic: subLabels.join(" · "),
    materiality: matLabels.join(" · "),
  };
}

/** ESRS 2 — always included in applicable DR list */
const ESRS2_BASE_DRS = [
  { ref: "BP-1", title: "Basis for preparation of the sustainability statement", standard: "ESRS 2", mandatory: true },
  { ref: "BP-2", title: "Specific information if the undertaking uses phasing-in options", standard: "ESRS 2", mandatory: true },
  { ref: "GOV-1", title: "Role of administrative management and supervisory bodies", standard: "ESRS 2", mandatory: true },
  { ref: "GOV-2", title: "Integration of sustainability-related performance in incentive schemes", standard: "ESRS 2", mandatory: true },
  { ref: "GOV-3", title: "Statement on due diligence", standard: "ESRS 2", mandatory: true },
  { ref: "GOV-4", title: "Risk management and internal controls over sustainability reporting", standard: "ESRS 2", mandatory: true },
  { ref: "SBM-1", title: "Strategy, business model and value chain", standard: "ESRS 2", mandatory: true },
  { ref: "SBM-2", title: "Interests and views of stakeholders", standard: "ESRS 2", mandatory: true },
  { ref: "SBM-3", title: "Interaction of material impacts, risks and opportunities with strategy", standard: "ESRS 2", mandatory: true },
  { ref: "IRO-1", title: "Process to identify and assess material impacts, risks and opportunities", standard: "ESRS 2", mandatory: true },
  { ref: "IRO-2", title: "Material impacts, risks and opportunities and disclosure requirements", standard: "ESRS 2", mandatory: true },
  { ref: "GDR-P", title: "General disclosure requirement for policies", standard: "ESRS 2", mandatory: true },
  { ref: "GDR-A", title: "General disclosure requirement for actions and resources", standard: "ESRS 2", mandatory: true },
  { ref: "GDR-M", title: "General disclosure requirement for metrics", standard: "ESRS 2", mandatory: true },
  { ref: "GDR-T", title: "General disclosure requirement for targets", standard: "ESRS 2", mandatory: true },
];

const E1_DR_CATALOG = {
  "E1-1": { title: "Transition plan for climate change mitigation", mandatory: true },
  "E1-2": {
    title: "Identification of climate-related risks and scenario analysis",
    mandatory: true,
  },
  "E1-3": { title: "Resilience in relation to climate change", mandatory: true },
  "E1-4": {
    title: "Policies related to climate change mitigation and adaptation",
    mandatory: true,
  },
  "E1-5": {
    title:
      "Actions and resources in relation to climate change mitigation and adaptation",
    mandatory: true,
  },
  "E1-6": { title: "Targets related to climate change", mandatory: true },
  "E1-7": { title: "Energy consumption and mix", mandatory: true },
  "E1-8": { title: "Gross Scope 1, 2, 3 GHG emissions", mandatory: true },
  "E1-9": {
    title:
      "GHG removals and GHG mitigation projects financed through carbon credits",
    mandatory: true,
  },
  "E1-10": { title: "Internal carbon pricing", mandatory: true },
  "E1-11": {
    title:
      "Anticipated financial effects from material physical and transition risks and potential climate-related opportunities",
    mandatory: true,
  },
};

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function parseEntitySpecificDisclosures(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) {
        return j.map(normalizeEntitySpecificEntry);
      }
    } catch {
      return [
        normalizeEntitySpecificEntry({
          id: `esd-legacy-${Date.now()}`,
          topic: "",
          description: String(raw),
        }),
      ];
    }
  }
  return [];
}

function normalizeEntitySpecificEntry(e) {
  return {
    id:
      e.id ||
      `esd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    topic: e.topic != null ? String(e.topic) : "",
    description: e.description != null ? String(e.description) : "",
    frameworkEnabled: !!e.frameworkEnabled,
    frameworkStandard:
      e.frameworkStandard != null ? String(e.frameworkStandard) : "",
    bestPracticesEnabled: !!e.bestPracticesEnabled,
    bestPracticesDescription:
      e.bestPracticesDescription != null
        ? String(e.bestPracticesDescription)
        : "",
  };
}

/** True when an entry has no user-visible content (used when loading from DB). */
function isEntitySpecificEntryEmpty(e) {
  const n = normalizeEntitySpecificEntry(e);
  return (
    !n.topic.trim() &&
    !n.description.trim() &&
    !n.frameworkEnabled &&
    !n.frameworkStandard.trim() &&
    !n.bestPracticesEnabled &&
    !n.bestPracticesDescription.trim()
  );
}

function newEntitySpecificEntry() {
  return normalizeEntitySpecificEntry({});
}

function defaultCompanyProfile() {
  return {
    companyName: "",
    country: "",
    sector: "",
    companySize: "medium",
    businessModel: "",
    valueChain: "",
    flowStep: 1,
  };
}

function defaultTopicAssessments() {
  /** @type {Record<string, any>} */
  const o = {};
  ESRS_TOPICS.forEach((t) => {
    if (t.code === "E1") {
      o.E1 = {
        level: null,
        subExpanded: false,
        subtopics: { mitigation: null, adaptation: null, energy: null },
        reasoning: "",
        notMaterialExplanation: "",
        forwardLookingAnalysis: "",
      };
    } else {
      o[t.code] = { level: null, locked: true };
    }
  });
  return o;
}

function normalizeCompanyProfile(raw) {
  const d = defaultCompanyProfile();
  if (!raw || typeof raw !== "object") return d;
  return {
    ...d,
    ...raw,
    flowStep: Number.isFinite(Number(raw.flowStep))
      ? Math.min(4, Math.max(1, Number(raw.flowStep)))
      : d.flowStep,
  };
}

function normalizeTopicAssessments(raw) {
  const d = defaultTopicAssessments();
  if (!raw || typeof raw !== "object") return d;
  Object.keys(d).forEach((k) => {
    if (raw[k] != null && typeof raw[k] === "object") {
      if (k === "E1") {
        const coerceE1Level = (v) => {
          if (v === "unsure") return E1_REQUIRES_FURTHER_ASSESSMENT;
          if (
            v === "material" ||
            v === "not_material" ||
            v === E1_REQUIRES_FURTHER_ASSESSMENT
          ) {
            return v;
          }
          return null;
        };
        const coerceSub = (v) => {
          if (v === "unsure") return E1_REQUIRES_FURTHER_ASSESSMENT;
          if (
            v === "material" ||
            v === "not_material" ||
            v === E1_REQUIRES_FURTHER_ASSESSMENT
          ) {
            return v;
          }
          return null;
        };
        const merged = { ...d.E1, ...raw.E1 };
        d.E1 = {
          ...merged,
          level: coerceE1Level(merged.level),
          subtopics: {
            mitigation: coerceSub(merged.subtopics?.mitigation),
            adaptation: coerceSub(merged.subtopics?.adaptation),
            energy: coerceSub(merged.subtopics?.energy),
          },
        };
      } else {
        d[k] = { ...d[k], ...raw[k], locked: true };
      }
    }
  });
  return d;
}

/**
 * @param {any} e1
 * @returns {DrRow[]}
 */
function buildE1DrRows(e1) {
  if (!e1 || e1.level === "not_material") return [];

  const level = e1.level;
  if (level !== "material" && level !== E1_REQUIRES_FURTHER_ASSESSMENT) {
    return [];
  }

  const sub = e1.subtopics || {};
  const expanded = !!e1.subExpanded;
  const subKeys = ["mitigation", "adaptation", "energy"];
  const hasGranular =
    expanded &&
    subKeys.some(
      (k) =>
        sub[k] === "material" ||
        sub[k] === "not_material" ||
        sub[k] === E1_REQUIRES_FURTHER_ASSESSMENT
    );

  if (!hasGranular) {
    return Object.keys(E1_DR_CATALOG).map((ref) => ({
      ref,
      title: E1_DR_CATALOG[ref].title,
      standard: "ESRS E1",
      mandatory: E1_DR_CATALOG[ref].mandatory,
    }));
  }

  const includeSubForDr = (k) => effectiveSubtopicIncludesDr(sub, e1, k);

  const refs = new Set();
  if (includeSubForDr("mitigation")) {
    ["E1-1", "E1-4", "E1-5", "E1-6", "E1-8", "E1-9", "E1-10"].forEach(
      (r) => refs.add(r)
    );
  }
  if (includeSubForDr("adaptation")) {
    ["E1-2", "E1-3", "E1-11"].forEach((r) => refs.add(r));
  }
  if (includeSubForDr("energy")) {
    ["E1-7", "E1-8"].forEach((r) => refs.add(r));
  }

  return Array.from(refs).sort().map((ref) => ({
    ref,
    title: E1_DR_CATALOG[ref]?.title || ref,
    standard: "ESRS E1",
    mandatory: true,
  }));
}

/**
 * @param {Record<string, any>} topicAssessments
 * @returns {DrRow[]}
 */
export function buildApplicableDrList(topicAssessments) {
  const rows = ESRS2_BASE_DRS.map((r) => ({
    ref: r.ref,
    title: r.title,
    standard: r.standard,
    mandatory: r.mandatory,
  }));
  const e1Rows = buildE1DrRows(topicAssessments?.E1);
  return [...rows, ...e1Rows];
}

function withRowIds(rows) {
  return rows.map((r, i) => ({
    ...r,
    id: r.id || `dr-${r.ref}-${i}`,
  }));
}

function getOpenAi() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing VITE_OPENAI_API_KEY.");
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
}

async function draftReasoningWithAi(companyProfile, topicLabel, materialityLabel, extraContext) {
  const openai = getOpenAi();
  const sys =
    "You draft concise, professional paragraphs for CSRD double materiality documentation under ESRS. " +
    "Use plain language suitable for sustainability reports. Do not invent company facts; ground suggestions in the profile provided.";
  const user = [
    `Company profile (JSON): ${JSON.stringify(companyProfile)}`,
    `Topic: ${topicLabel}`,
    `Materiality conclusion: ${materialityLabel}`,
    extraContext ? `Additional context: ${extraContext}` : "",
    "Write one short paragraph (120–200 words) explaining the materiality reasoning for this topic, suitable for ESRS IRO documentation.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });
  const text = res.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No text returned from model.");
  return text;
}

function loadNotMaterialCombinedForReport(e1) {
  if (!e1) return "";
  const a = (e1.notMaterialExplanation || "").trim();
  const b = (e1.forwardLookingAnalysis || "").trim();
  if (a && b && a === b) return a;
  if (a && b) return `${a}\n\n${b}`;
  return a || b;
}

function formatCompanySizeLabel(size) {
  if (size === "large") return "Large";
  if (size === "small") return "Small";
  if (size === "medium") return "Medium";
  return size ? String(size) : "—";
}

function formatE1SubtopicsScreeningCell(e1) {
  const sub = e1.subtopics || {};
  const expanded = !!e1.subExpanded;
  const subKeyList = E1_SUB_KEYS.map((x) => x.key);
  const hasGranular =
    expanded &&
    subKeyList.some(
      (k) =>
        sub[k] === "material" ||
        sub[k] === "not_material" ||
        sub[k] === E1_REQUIRES_FURTHER_ASSESSMENT
    );
  if (!hasGranular) return "Topic level";
  return E1_SUB_KEYS.map((st) => {
    const v = sub[st.key];
    let dec = "—";
    if (v === "material") dec = "Material";
    else if (v === "not_material") dec = "Not material";
    else if (v === E1_REQUIRES_FURTHER_ASSESSMENT) dec = "Requires further assessment";
    else if (v == null) dec = "Inherits parent topic";
    return `${st.label}: ${dec}`;
  }).join("; ");
}

function dmaWordSanitizeFilename(name) {
  return String(name || "report")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 80);
}

/** @param {string} text */
function dmaWordParagraphsFromPlainText(text) {
  const raw = text ?? "";
  if (!raw) return [new Paragraph({ children: [new TextRun("—")] })];
  const lines = raw.split("\n");
  return lines.map(line => new Paragraph({ children: [new TextRun(line)] }));
}

/** @param {string[]} cells */
function dmaWordTableRow(cells, header) {
  return new TableRow({
    children: cells.map(
      (c) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(c ?? "—"),
                  bold: !!header,
                }),
              ],
            }),
          ],
        })
    ),
  });
}

/**
 * @param {Record<string, any>} topicAssessments
 * @returns {{ topic: string, subtopic: string, materiality: string }[]}
 */
function buildTopicScreeningRowsForWord(topicAssessments) {
  const rows = [];
  const e1 = topicAssessments?.E1 || {};
  const e1LevelLabel = topicE1MaterialityLabel(e1.level);

  for (const t of ESRS_TOPICS) {
    if (t.interactive) {
      const sub = e1.subtopics || {};
      const expanded = !!e1.subExpanded;
      const subKeyList = E1_SUB_KEYS.map((x) => x.key);
      const hasGranular =
        expanded &&
        subKeyList.some(
          (k) =>
            sub[k] === "material" ||
            sub[k] === "not_material" ||
            sub[k] === E1_REQUIRES_FURTHER_ASSESSMENT
        );

      if (hasGranular) {
        for (const st of E1_SUB_KEYS) {
          let dec = effectiveSubtopicDisplayLabel(sub, e1, st.key);
          if (!dec) {
            const v = effectiveSubtopicValue(sub, e1, st.key);
            dec = v == null ? "Inherits parent topic" : "—";
          }
          rows.push({
            topic: `${t.code} — ${t.name}`,
            subtopic: st.label,
            materiality: dec,
          });
        }
      } else {
        rows.push({
          topic: `${t.code} — ${t.name}`,
          subtopic: "—",
          materiality: e1LevelLabel || "—",
        });
      }
    } else {
      rows.push({
        topic: `${t.code} — ${t.name}`,
        subtopic: "—",
        materiality: "Not assessed in this version",
      });
    }
  }
  return rows;
}

/**
 * @param {{
 *   companyProfile: Record<string, any>,
 *   topicAssessments: Record<string, any>,
 *   drRows: DrRow[],
 *   entityEntries: any[],
 *   reportingYear: number,
 *   generatedAt: Date,
 * }} opts
 */
function buildDmaWordDocument({
  companyProfile,
  topicAssessments,
  drRows,
  entityEntries,
  reportingYear,
  generatedAt,
}) {
  const genStr =
    generatedAt instanceof Date
      ? generatedAt.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : String(generatedAt);

  const e1 = topicAssessments?.E1 || {};
  const e1LevelLabel = topicE1MaterialityLabel(e1.level);

  const dmaReportFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: [
              "Draft — amended ESRS 2.0 (draft). Not for submission without professional review. Page ",
              PageNumber.CURRENT,
            ],
          }),
        ],
      }),
    ],
  });

  const coverChildren = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun("Double Materiality Assessment Report")],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(companyProfile.companyName || "—")],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(`Reporting period: ${reportingYear}`)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(`Date generated: ${genStr}`)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun("Prepared using ESG Reporting Suite")],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun(
          "Based on amended ESRS 2.0 — top-down approach per amended ESRS 1 AR 17"
        ),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun(
          "Draft report — based on amended ESRS 2.0 draft standards. Not for submission without professional review."
        ),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const companyProfileChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Company Profile")],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Company name: ", bold: true }),
        new TextRun(companyProfile.companyName || "—"),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Country: ", bold: true }),
        new TextRun(companyProfile.country || "—"),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Sector: ", bold: true }),
        new TextRun(companyProfile.sector || "—"),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Size: ", bold: true }),
        new TextRun(formatCompanySizeLabel(companyProfile.companySize)),
      ],
    }),
    new Paragraph({
      children: [new TextRun({ text: "Business model: ", bold: true })],
    }),
    ...dmaWordParagraphsFromPlainText(companyProfile.businessModel || ""),
    new Paragraph({
      children: [new TextRun({ text: "Value chain: ", bold: true })],
    }),
    ...dmaWordParagraphsFromPlainText(companyProfile.valueChain || ""),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const screeningRows = buildTopicScreeningRowsForWord(topicAssessments);
  const screeningTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      dmaWordTableRow(["Topic", "Sub-topic", "Materiality decision"], true),
      ...screeningRows.map((r) =>
        dmaWordTableRow([r.topic, r.subtopic, r.materiality], false)
      ),
    ],
  });

  const screeningChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Topic Screening Results")],
    }),
    screeningTable,
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const reasoningChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Materiality Reasoning")],
    }),
  ];

  if (ESRS_TOPICS.some((t) => t.interactive)) {
    const head = `E1 — Climate change — ${e1LevelLabel || "—"}`;
    if (e1.level === "material" || e1.level === E1_REQUIRES_FURTHER_ASSESSMENT) {
      reasoningChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(head)],
        }),
        new Paragraph({
          children: [new TextRun({ text: "Reasoning", bold: true })],
        }),
        ...dmaWordParagraphsFromPlainText(e1.reasoning || "")
      );
    } else if (e1.level === "not_material") {
      const combined = loadNotMaterialCombinedForReport(e1);
      reasoningChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(head)],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Detailed explanation and forward-looking analysis",
              bold: true,
            }),
          ],
        }),
        ...dmaWordParagraphsFromPlainText(combined)
      );
    } else {
      reasoningChildren.push(new Paragraph({ children: [new TextRun("—")] }));
    }
  } else {
    reasoningChildren.push(new Paragraph({ children: [new TextRun("—")] }));
  }

  reasoningChildren.push(new Paragraph({ children: [new PageBreak()] }));

  const omittedCount = drRows.filter((r) => r.omitted).length;
  const totalCount = drRows.length;

  const drTableRows = [
    dmaWordTableRow(
      [
        "DR Reference",
        "Title",
        "Standard",
        "Sub-topic",
        "Materiality decision",
        "Omitted",
        "Omission reason",
      ],
      true
    ),
    ...drRows.map((r) => {
      const cols = drRowTableColumns(r.ref, r.standard, topicAssessments);
      const omitted = !!r.omitted;
      const omitReasonText = omitted
        ? [r.omissionReason, r.omissionJustification].filter(Boolean).join(" — ") ||
          "—"
        : "—";
      return dmaWordTableRow(
        [
          r.ref,
          r.title,
          r.standard,
          cols.subtopic || "—",
          cols.materiality || "—",
          omitted ? "Yes" : "No",
          omitReasonText,
        ],
        false
      );
    }),
  ];

  const drChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Applicable Disclosure Requirements")],
    }),
    new Paragraph({
      children: [
        new TextRun(
          "Based on amended ESRS 2.0. ESRS 2 general disclosures apply to all undertakings. Topical DRs apply based on materiality assessment above."
        ),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: drTableRows,
    }),
    new Paragraph({
      children: [
        new TextRun(
          `Total DRs: ${totalCount}. Omitted DRs: ${omittedCount}.`
        ),
      ],
    }),
  ];

  const bodyChildren = [
    ...coverChildren,
    ...companyProfileChildren,
    ...screeningChildren,
    ...reasoningChildren,
    ...drChildren,
  ];

  if (entityEntries.length > 0) {
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
    bodyChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Entity-specific Disclosures")],
      })
    );
    entityEntries.forEach((e, i) => {
      const comp = [];
      if (e.frameworkEnabled) {
        comp.push(
          `Following a framework or reporting standard: ${e.frameworkStandard || "—"}`
        );
      }
      if (e.bestPracticesEnabled) {
        comp.push(
          `Using available best practices: ${e.bestPracticesDescription || "—"}`
        );
      }
      const compStr = comp.length ? comp.join("\n\n") : "—";
      bodyChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(`Disclosure ${i + 1}`)],
        }),
        new Paragraph({
          children: [new TextRun({ text: "Topic: ", bold: true })],
        }),
        ...dmaWordParagraphsFromPlainText(e.topic || ""),
        new Paragraph({
          children: [new TextRun({ text: "Description: ", bold: true })],
        }),
        ...dmaWordParagraphsFromPlainText(e.description || ""),
        new Paragraph({
          children: [
            new TextRun({ text: "Comparability approach: ", bold: true }),
          ],
        }),
        ...dmaWordParagraphsFromPlainText(compStr)
      );
    });
  }

  return new Document({
    sections: [
      {
        footers: {
          default: dmaReportFooter,
        },
        children: bodyChildren,
      },
    ],
  });
}

/**
 * Fetches the completed DMA assessment and downloads a Word (.docx) report in the browser.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} reportingPeriodId
 * @param {number} reportingYear
 * @returns {Promise<boolean>} true if the file was generated and downloaded
 */
export async function downloadDmaAssessmentWordReport(
  supabase,
  reportingPeriodId,
  reportingYear
) {
  const { data: userData, error: uErr } = await supabase.auth.getUser();
  if (uErr || !userData?.user) return false;

  const { data, error } = await supabase
    .from("dma_assessments")
    .select("*")
    .eq("reporting_period_id", reportingPeriodId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    console.error("dma report fetch:", error);
    return false;
  }
  if (!data || data.status !== "completed") return false;

  const companyProfile = normalizeCompanyProfile(data.company_profile);
  const topicAssessments = normalizeTopicAssessments(data.topic_assessments);
  const drRows = Array.isArray(data.dr_list) ? withRowIds(data.dr_list) : [];
  const entityEntries = parseEntitySpecificDisclosures(
    data.entity_specific_disclosures
  ).filter((e) => !isEntitySpecificEntryEmpty(e));

  console.log("[DMA report] assessment data used for report", data);

  const doc = buildDmaWordDocument({
    companyProfile,
    topicAssessments,
    drRows,
    entityEntries,
    reportingYear,
    generatedAt: new Date(),
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DMA-${reportingYear}-${dmaWordSanitizeFilename(companyProfile.companyName || "report")}.docx`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return true;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export function initDma(supabase) {
  const root = document.getElementById("dma-root");
  if (!root) return;

  let assessmentId = null;
  let reportingPeriodId = null;
  let companyProfile = defaultCompanyProfile();
  let topicAssessments = defaultTopicAssessments();
  /** @type {DrRow[]} */
  let drList = [];
  let entitySpecificEntries = [];
  /** @type {string | null} */
  let dmaStep4OmitFormRowId = null;
  /** Step 4 DR table column visibility (not persisted). */
  let step4ColumnVisibility = {
    topic: true,
    subtopic: true,
    materiality: true,
    ref: true,
    title: true,
    standard: true,
    actions: true,
  };
  let status = "in_progress";

  async function resolveReportingPeriodId() {
    const sel = document.getElementById("reporting-period-select");
    const yearStr = sel?.value || "";
    if (!yearStr) return null;
    const y = parseInt(yearStr, 10);
    if (!Number.isFinite(y)) return null;
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) return null;
    const { data, error } = await supabase
      .from("reporting_periods")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("year", y)
      .maybeSingle();
    if (error) {
      console.error("dma reporting_periods:", error);
      return null;
    }
    return data?.id ?? null;
  }

  async function loadAssessment() {
    reportingPeriodId = await resolveReportingPeriodId();
    assessmentId = null;
    companyProfile = defaultCompanyProfile();
    topicAssessments = defaultTopicAssessments();
    drList = [];
    entitySpecificEntries = [];
    dmaStep4OmitFormRowId = null;
    step4ColumnVisibility = {
      topic: true,
      subtopic: true,
      materiality: true,
      ref: true,
      title: true,
      standard: true,
      actions: true,
    };
    status = "in_progress";

    if (!reportingPeriodId) {
      render();
      return;
    }

    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) {
      render();
      return;
    }

    const { data, error } = await supabase
      .from("dma_assessments")
      .select("*")
      .eq("reporting_period_id", reportingPeriodId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (error) {
      console.error("dma_assessments load:", error);
      render();
      return;
    }

    if (data) {
      assessmentId = data.id;
      companyProfile = normalizeCompanyProfile(data.company_profile);
      topicAssessments = normalizeTopicAssessments(data.topic_assessments);
      drList = Array.isArray(data.dr_list) ? withRowIds(data.dr_list) : [];
      entitySpecificEntries = parseEntitySpecificDisclosures(
        data.entity_specific_disclosures
      ).filter((e) => !isEntitySpecificEntryEmpty(e));
      status = data.status || "in_progress";
    }
    render();
  }

  async function persistPartial(patch) {
    if (!reportingPeriodId) {
      queueMicrotask(() =>
        showDmaInlineMessage("Select a reporting period first.", "info")
      );
      return false;
    }
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) return false;

    const esdStr =
      patch.entity_specific_disclosures !== undefined
        ? patch.entity_specific_disclosures
        : JSON.stringify(entitySpecificEntries);

    const base = {
      user_id: userData.user.id,
      reporting_period_id: reportingPeriodId,
      company_profile: { ...companyProfile, ...patch.company_profile },
      topic_assessments: patch.topic_assessments ?? topicAssessments,
      dr_list: patch.dr_list ?? drList,
      entity_specific_disclosures: esdStr,
      status: patch.status ?? status,
    };

    companyProfile = normalizeCompanyProfile(base.company_profile);
    topicAssessments = normalizeTopicAssessments(base.topic_assessments);
    drList = base.dr_list;
    entitySpecificEntries = parseEntitySpecificDisclosures(esdStr);
    status = base.status;

    if (assessmentId) {
      const { error } = await supabase
        .from("dma_assessments")
        .update({
          company_profile: companyProfile,
          topic_assessments: topicAssessments,
          dr_list: drList,
          entity_specific_disclosures: esdStr,
          status,
        })
        .eq("id", assessmentId)
        .eq("user_id", userData.user.id);
      if (error) {
        console.error("dma update:", error);
        queueMicrotask(() => showDmaInlineMessage("Could not save.", "error"));
        return false;
      }
    } else {
      const { data: ins, error } = await supabase
        .from("dma_assessments")
        .insert({
          user_id: userData.user.id,
          reporting_period_id: reportingPeriodId,
          company_profile: companyProfile,
          topic_assessments: topicAssessments,
          dr_list: drList,
          entity_specific_disclosures: esdStr,
          status,
        })
        .select("id")
        .single();
      if (error) {
        console.error("dma insert:", error);
        queueMicrotask(() => showDmaInlineMessage("Could not save.", "error"));
        return false;
      }
      assessmentId = ins?.id ?? null;
    }
    return true;
  }

  function showDmaInlineMessage(msg, variant) {
    const el = document.getElementById("dma-flow-message");
    if (!el) return;
    clearTimeout(showDmaInlineMessage._t);
    el.textContent = msg;
    el.classList.remove("hidden");
    const colors = {
      success: "#0d9488",
      error: "#b91c1c",
      info: "#64748b",
    };
    el.style.color = colors[variant] || colors.info;
    showDmaInlineMessage._t = setTimeout(() => {
      el.classList.add("hidden");
      el.textContent = "";
    }, 3000);
  }

  function showAiDraftSuccess(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const key = `_draftOk_${elementId}`;
    clearTimeout(showAiDraftSuccess[key]);
    el.textContent = "Draft inserted — review and edit before saving.";
    el.classList.remove("hidden");
    showAiDraftSuccess[key] = setTimeout(() => {
      el.classList.add("hidden");
      el.textContent = "";
    }, 3000);
  }

  function stepFromProfile() {
    return companyProfile.flowStep || 1;
  }

  function setStep(n) {
    companyProfile.flowStep = n;
  }

  function renderProgress() {
    const labels = [
      { n: 1, t: "Company profile" },
      { n: 2, t: "Topic screening" },
      { n: 3, t: "Reasoning" },
      { n: 4, t: "DR list" },
    ];
    const cur = stepFromProfile();
    return `
      <nav class="dma-progress" aria-label="DMA steps">
        ${labels
          .map((l) => {
            const active = l.n === cur;
            const done = l.n < cur;
            return `<span class="dma-progress-step ${active ? "is-active" : ""} ${done ? "is-done" : ""}">${escapeHtml(l.t)}</span>`;
          })
          .join('<span class="dma-progress-sep" aria-hidden="true"><span class="dma-progress-arrow">→</span></span>')}
      </nav>
    `;
  }

  function loadNotMaterialCombined(e1) {
    const a = (e1.notMaterialExplanation || "").trim();
    const b = (e1.forwardLookingAnalysis || "").trim();
    if (a && b && a === b) return a;
    if (a && b) return `${a}\n\n${b}`;
    return a || b;
  }

  function renderStep1() {
    const p = companyProfile;
    return `
      <div class="dma-step">
        <h3 class="dma-step-title">Step 1 — Company profile</h3>
        <p class="dma-step-intro">Basic information about the reporting entity (top-down DMA context).</p>
        <div class="dma-form">
          <div class="field">
            <label for="dma-company-name">Company name</label>
            <input type="text" id="dma-company-name" class="dma-input" value="${escapeHtml(p.companyName)}" />
          </div>
          <div class="field">
            <label for="dma-country">Country</label>
            <input type="text" id="dma-country" class="dma-input" value="${escapeHtml(p.country)}" />
          </div>
          <div class="field">
            <label for="dma-sector">Sector</label>
            <input type="text" id="dma-sector" class="dma-input" placeholder="e.g. Manufacturing" value="${escapeHtml(p.sector)}" />
          </div>
          <div class="field">
            <label for="dma-size">Company size</label>
            <select id="dma-size" class="dma-input">
              <option value="large" ${p.companySize === "large" ? "selected" : ""}>Large</option>
              <option value="medium" ${p.companySize === "medium" ? "selected" : ""}>Medium</option>
              <option value="small" ${p.companySize === "small" ? "selected" : ""}>Small</option>
            </select>
          </div>
          <div class="field">
            <label for="dma-bm">Brief business model description</label>
            <textarea id="dma-bm" class="dma-textarea" rows="3">${escapeHtml(p.businessModel)}</textarea>
          </div>
          <div class="field">
            <label for="dma-vc">Value chain overview</label>
            <textarea id="dma-vc" class="dma-textarea" rows="3">${escapeHtml(p.valueChain)}</textarea>
          </div>
        </div>
        <div class="dma-actions">
          <button type="button" class="btn btn-primary" id="dma-s1-next">Next</button>
        </div>
      </div>
    `;
  }

  function materialityRadiosTopic(name, value, disabled) {
    const opts = [
      { v: "material", l: "Material" },
      { v: "not_material", l: "Not material" },
      { v: E1_REQUIRES_FURTHER_ASSESSMENT, l: "Requires further assessment" },
    ];
    return opts
      .map(
        (o) => `
      <label class="dma-radio ${disabled ? "is-disabled" : ""}">
        <input type="radio" name="${name}" value="${o.v}" ${value === o.v ? "checked" : ""} ${disabled ? "disabled" : ""} />
        ${escapeHtml(o.l)}
      </label>
    `
      )
      .join("");
  }

  function materialityRadiosSubtopic(name, value, disabled) {
    const opts = [
      { v: "material", l: "Material" },
      { v: "not_material", l: "Not material" },
      { v: E1_REQUIRES_FURTHER_ASSESSMENT, l: "Requires further assessment" },
    ];
    return opts
      .map(
        (o) => `
      <label class="dma-radio ${disabled ? "is-disabled" : ""}">
        <input type="radio" name="${name}" value="${o.v}" ${value === o.v ? "checked" : ""} ${disabled ? "disabled" : ""} />
        ${escapeHtml(o.l)}
      </label>
    `
      )
      .join("");
  }

  function materialityRowTopic(name, value, disabled, compact) {
    const rowClass = compact ? "dma-mat-row dma-mat-row--compact" : "dma-mat-row";
    return `
      <div class="dma-mat-row-wrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem 0.75rem">
        <div class="${rowClass}">
          ${materialityRadiosTopic(name, value, disabled)}
        </div>
        <button type="button" class="btn btn-secondary btn-compact dma-mat-clear" data-mat-name="${escapeHtml(name)}" ${disabled ? "disabled" : ""}>Clear</button>
      </div>
    `;
  }

  function materialityRowSubtopic(name, value, disabled) {
    const rowClass = "dma-mat-row dma-mat-row--compact";
    return `
      <div class="dma-mat-row-wrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem 0.75rem">
        <div class="${rowClass}">
          ${materialityRadiosSubtopic(name, value, disabled)}
        </div>
        <button type="button" class="btn btn-secondary btn-compact dma-mat-clear" data-mat-name="${escapeHtml(name)}" ${disabled ? "disabled" : ""}>Clear</button>
      </div>
    `;
  }

  function renderStep2() {
    const e1 = topicAssessments.E1 || {};
    const warnHidden = e1.level !== "not_material";

    const e1Block = `
      <div class="dma-topic dma-topic--active">
        <div class="dma-topic-head">
          <strong>E1 — ${escapeHtml(ESRS_TOPICS.find((x) => x.code === "E1")?.name || "Climate change")}</strong>
        </div>
        ${materialityRowTopic("e1-level", e1.level, false, false)}
        <div id="dma-e1-further-note" class="dma-e1-further-note ${e1.level !== E1_REQUIRES_FURTHER_ASSESSMENT ? "hidden" : ""}" role="status">
          This topic will be treated as material until assessment is complete. All related DRs will be included.
        </div>
        <div id="dma-e1-notmat-warning" class="dma-warning ${warnHidden ? "hidden" : ""}" role="status">
          Note: If climate change is not material, amended ESRS 1 requires a detailed explanation of your conclusions and a forward-looking analysis. You will be asked to document this in the next step.
        </div>
        <details class="dma-details" ${e1.subExpanded ? "open" : ""}>
          <summary>Optional: sub-topics (E1)</summary>
          <p class="dma-details-hint">Climate change mitigation, adaptation, and energy — refine which E1 disclosures may apply.</p>
          ${E1_SUB_KEYS.map((st) => {
            const v = e1.subtopics?.[st.key] ?? null;
            return `
            <div class="dma-subtopic">
              <div class="dma-subtopic-label">${escapeHtml(st.label)}</div>
              ${materialityRowSubtopic(`e1-sub-${st.key}`, v, false)}
            </div>`;
          }).join("")}
        </details>
        <div id="dma-e1-sub-invalid" class="dma-e1-sub-invalid ${isE1AllSubtopicsExplicitlyNotMaterial(e1) ? "" : "hidden"}" role="alert">
          At least one sub-topic must be Material or Requires further assessment when the parent topic is material. If none of the sub-topics are material, reconsider the parent topic materiality decision.
        </div>
      </div>
    `;

    const otherTopics = ESRS_TOPICS.filter((t) => !t.interactive)
      .map(
        (t) => `
      <div class="dma-topic dma-topic--locked">
        <strong>${escapeHtml(t.code)} — ${escapeHtml(t.name)}</strong>
        <span class="dma-badge-soon">Coming soon</span>
      </div>
    `
      )
      .join("");

    return `
      <div class="dma-step">
        <h3 class="dma-step-title">Step 2 — Topic screening</h3>
        <p class="dma-step-intro">Nine ESRS topical standards. Only E1 (climate change) is available in this tool; others follow in future releases.</p>
        ${e1Block}
        <div class="dma-topic-grid">${otherTopics}</div>
        <p class="dma-footnote-soon">More standards coming soon</p>
        <div class="dma-actions">
          <button type="button" class="btn btn-secondary" id="dma-s2-back">Back</button>
          <button type="button" class="btn btn-primary" id="dma-s2-next" ${isE1AllSubtopicsExplicitlyNotMaterial(e1) ? "disabled" : ""}>Next</button>
        </div>
      </div>
    `;
  }

  function renderStep3() {
    const e1 = topicAssessments.E1 || {};
    const lvl = e1.level;
    let body = "";

    if (lvl === "material" || lvl === E1_REQUIRES_FURTHER_ASSESSMENT) {
      body = `
        <div class="field">
          <label>Climate change (E1) — materiality: ${escapeHtml(lvl === "material" ? "Material" : "Requires further assessment")}</label>
          <p class="field-hint">Include any sub-topic judgments (mitigation, adaptation, energy) in this single topic-level narrative.</p>
          <textarea id="dma-e1-reason" class="dma-textarea dma-textarea--reasoning" placeholder="Document your reasoning for this conclusion (E1 as a whole, including sub-topics where relevant).">${escapeHtml(e1.reasoning || "")}</textarea>
        </div>
        <button type="button" class="btn btn-secondary btn-compact" id="dma-ai-e1">Draft reasoning with AI</button>
        <p id="dma-ai-e1-error" class="hidden" role="alert" style="margin:0.35rem 0 0;font-size:0.8125rem;color:#b91c1c;max-width:36rem;line-height:1.4;"></p>
      `;
    } else if (lvl === "not_material") {
      body = `
        <div class="field">
          <label>Climate change (E1) — materiality: Not material</label>
          <p class="field-hint">Amended ESRS 1 requires a detailed explanation and forward-looking analysis. Capture both in the narrative below (E1 as a whole, including sub-topics where relevant).</p>
          <textarea id="dma-e1-notmat-combined" class="dma-textarea dma-textarea--reasoning">${escapeHtml(loadNotMaterialCombined(e1))}</textarea>
        </div>
        <button type="button" class="btn btn-secondary btn-compact" id="dma-ai-e1-nm">Draft reasoning with AI</button>
        <p id="dma-ai-e1-nm-error" class="hidden" role="alert" style="margin:0.35rem 0 0;font-size:0.8125rem;color:#b91c1c;max-width:36rem;line-height:1.4;"></p>
        <p id="dma-ai-e1-nm-success" class="hidden" role="status" style="margin:0.35rem 0 0;font-size:0.8125rem;color:#0d9488;max-width:36rem;line-height:1.4;"></p>
      `;
    } else {
      body = `<p class="dma-hint">Complete topic screening for E1 in step 2.</p>`;
    }

    return `
      <div class="dma-step">
        <h3 class="dma-step-title">Step 3 — Reasoning documentation</h3>
        <p class="dma-step-intro">Document judgments per amended ESRS 1 AR 17 (top-down DMA).</p>
        ${body}
        <div class="dma-actions">
          <button type="button" class="btn btn-secondary" id="dma-s3-back">Back</button>
          <button type="button" class="btn btn-primary" id="dma-s3-next" ${!lvl ? "disabled" : ""}>Next</button>
        </div>
      </div>
    `;
  }

  const STEP4_COL_DEFS = [
    ["topic", "Topic"],
    ["subtopic", "Sub-topic"],
    ["materiality", "Materiality decision"],
    ["ref", "DR reference"],
    ["title", "Title"],
    ["standard", "Standard"],
    ["actions", "Omit"],
  ];

  function applyStep4ColumnVisibility() {
    STEP4_COL_DEFS.forEach(([k]) => {
      const visible = step4ColumnVisibility[k];
      root.querySelectorAll(`[data-dr-col="${k}"]`).forEach((el) => {
        el.classList.toggle("dma-dr-col--hidden", !visible);
      });
    });
  }

  function renderEntitySpecificSection() {
    const blocks = entitySpecificEntries
      .map(
        (e) => `
      <div class="dma-esd-entry" data-esd-id="${escapeHtml(e.id)}">
        <div class="field">
          <label>Topic</label>
          <input type="text" class="dma-input dma-esd-topic" value="${escapeHtml(e.topic)}" />
        </div>
        <div class="field">
          <label>Description of the material impact, risk or opportunity</label>
          <textarea class="dma-textarea dma-esd-description" rows="3">${escapeHtml(e.description)}</textarea>
        </div>
        <p class="dma-esd-comp-hint"><strong>Ensuring comparability (amended ESRS 1, para. 12)</strong></p>
        <p class="field-hint dma-esd-comp-note">Select at least one approach to ensure comparability over time and with other undertakings in the same sector</p>
        <label class="dma-esd-check">
          <input type="checkbox" class="dma-esd-fw" ${e.frameworkEnabled ? "checked" : ""} />
          Following a framework or reporting standard
        </label>
        <div class="field dma-esd-fw-wrap ${e.frameworkEnabled ? "" : "hidden"}">
          <label>Which standard? (e.g. GRI Sector Standards, IFRS industry-based guidance)</label>
          <input type="text" class="dma-input dma-esd-fw-std" value="${escapeHtml(e.frameworkStandard)}" />
        </div>
        <label class="dma-esd-check">
          <input type="checkbox" class="dma-esd-bp" ${e.bestPracticesEnabled ? "checked" : ""} />
          Using available best practices
        </label>
        <div class="field dma-esd-bp-wrap ${e.bestPracticesEnabled ? "" : "hidden"}">
          <label>Describe the best practices used</label>
          <textarea class="dma-textarea dma-esd-bp-desc" rows="2">${escapeHtml(e.bestPracticesDescription)}</textarea>
        </div>
        <button type="button" class="btn btn-secondary btn-compact dma-esd-remove" data-esd-id="${escapeHtml(e.id)}">Remove</button>
      </div>
    `
      )
      .join("");

    return `
      <div class="dma-esd-section">
        <h4 class="dma-esd-heading">Entity-specific disclosures</h4>
        <p class="dma-esd-sub">Add disclosures for material topics not covered or not covered with sufficient granularity by ESRS (amended ESRS 1, para. 11)</p>
        <div id="dma-esd-entries">${blocks}</div>
        <button type="button" id="dma-esd-add" class="btn btn-secondary btn-compact">+ Add disclosure</button>
      </div>
    `;
  }

  function renderStep4() {
    const rows = drList.length ? drList : buildApplicableDrList(topicAssessments);
    const withIds = withRowIds(rows);
    const v = step4ColumnVisibility;
    const h = (k) => (!v[k] ? " dma-dr-col--hidden" : "");
    const omitOpts = OMISSION_REASON_OPTIONS.map(
      (o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`
    ).join("");

    const columnPickerRows = STEP4_COL_DEFS.map(
      ([key, label]) => `
        <label class="dma-dr-columns-row">
          <input type="checkbox" class="dma-dr-col-toggle" data-dr-col-toggle="${escapeHtml(key)}" ${v[key] ? "checked" : ""} />
          <span>${escapeHtml(label)}</span>
        </label>`
    ).join("");

    const tableRows = withIds
      .map((r) => {
        const id = r.id || "";
        const omitted = !!r.omitted;
        const strikeClass = omitted ? "dma-dr-cell--strike" : "";
        const cols = drRowTableColumns(r.ref, r.standard, topicAssessments);
        const omitNote =
          omitted && r.omissionReason
            ? `<div class="dma-dr-omit-note">${escapeHtml(r.omissionReason)}${r.omissionJustification ? ` — ${escapeHtml(r.omissionJustification)}` : ""}</div>`
            : "";
        const actions = omitted
          ? `<button type="button" class="btn btn-secondary btn-compact dma-undo-omit" data-dr-id="${escapeHtml(id)}">Undo omission</button>`
          : `<button type="button" class="btn btn-secondary btn-compact dma-omit-dr" data-dr-id="${escapeHtml(id)}">Omit</button>`;
        const omitFormRow =
          dmaStep4OmitFormRowId && String(dmaStep4OmitFormRowId) === String(id)
            ? `<tr class="dma-omit-form-row" data-for-dr-id="${escapeHtml(id)}">
            <td colspan="7">
              <div class="dma-omit-form-inner">
                <div class="field">
                  <label>Reason for omission</label>
                  <select class="dma-input dma-omit-reason-select">
                    <option value="">Select…</option>
                    ${omitOpts}
                  </select>
                </div>
                <div class="field">
                  <label>Justification</label>
                  <input type="text" class="dma-input dma-omit-justification" placeholder="Required" />
                </div>
                <div class="dma-omit-form-actions">
                  <button type="button" class="btn btn-primary btn-compact dma-omit-confirm" data-dr-id="${escapeHtml(id)}">Confirm omission</button>
                  <button type="button" class="btn btn-secondary btn-compact dma-omit-cancel">Cancel</button>
                </div>
                <p class="dma-omit-form-err hidden" role="alert" style="margin:0.35rem 0 0;font-size:0.8125rem;color:#b91c1c;"></p>
              </div>
            </td>
          </tr>`
            : "";
        return `
      <tr class="dma-dr-row ${omitted ? "dma-dr-row--omitted" : ""}" data-dr-id="${escapeHtml(id)}">
        <td data-dr-col="topic" class="dma-dr-col${h("topic")} ${strikeClass}">${escapeHtml(cols.topic)}</td>
        <td data-dr-col="subtopic" class="dma-dr-col${h("subtopic")} ${strikeClass}">${escapeHtml(cols.subtopic)}</td>
        <td data-dr-col="materiality" class="dma-dr-col${h("materiality")} ${strikeClass}">${escapeHtml(cols.materiality)}</td>
        <td data-dr-col="ref" class="dma-dr-col${h("ref")} ${strikeClass}"><code>${escapeHtml(r.ref)}</code></td>
        <td data-dr-col="title" class="dma-dr-col${h("title")} ${strikeClass}">${escapeHtml(r.title)}${omitNote}</td>
        <td data-dr-col="standard" class="dma-dr-col${h("standard")} ${strikeClass}">${escapeHtml(r.standard)}</td>
        <td data-dr-col="actions" class="dma-dr-col dma-dr-actions${h("actions")}">${actions}</td>
      </tr>
      ${omitFormRow}
    `;
      })
      .join("");

    return `
      <div class="dma-step">
        <h3 class="dma-step-title">Step 4 — Applicable disclosure requirements</h3>
        <p class="dma-step-intro">ESRS 2 DRs apply together with E1 DRs derived from your E1 screening. You can adjust the list manually.</p>
        <div class="dma-step4-dr-block">
        <div class="dma-dr-columns-toolbar">
          <details class="dma-dr-columns-details">
            <summary class="btn btn-secondary btn-compact dma-dr-columns-summary">Columns</summary>
            <div class="dma-dr-columns-dropdown" role="group" aria-label="Show or hide columns">
              ${columnPickerRows}
            </div>
          </details>
        </div>
        <div class="dma-table-scroll-y dma-table-wrap dma-table-wrap--step4">
          <table class="dma-table dma-table--step4">
            <thead>
              <tr>
                <th data-dr-col="topic" class="dma-dr-col${h("topic")}">Topic</th>
                <th data-dr-col="subtopic" class="dma-dr-col${h("subtopic")}">Sub-topic</th>
                <th data-dr-col="materiality" class="dma-dr-col${h("materiality")}">Materiality decision</th>
                <th data-dr-col="ref" class="dma-dr-col${h("ref")}">DR reference</th>
                <th data-dr-col="title" class="dma-dr-col${h("title")}">Title</th>
                <th data-dr-col="standard" class="dma-dr-col${h("standard")}">Standard</th>
                <th data-dr-col="actions" class="dma-dr-col dma-dr-actions-th${h("actions")}" aria-label="Omit"></th>
              </tr>
            </thead>
            <tbody>${tableRows || '<tr><td colspan="7">No rows</td></tr>'}</tbody>
          </table>
        </div>
        <button type="button" class="btn btn-secondary btn-compact" id="dma-regen">Regenerate from topic screening</button>
        </div>
        ${renderEntitySpecificSection()}
        <div class="dma-actions">
          <button type="button" class="btn btn-secondary" id="dma-s4-back">Back</button>
          ${status === "completed" ? `<button type="button" class="btn btn-secondary" id="dma-download-report">Download Word report</button>` : ""}
          <button type="button" class="btn btn-primary" id="dma-s4-save">Approve and save</button>
        </div>
      </div>
    `;
  }

  function render() {
    if (!reportingPeriodId) {
      root.innerHTML = `
        ${renderProgress()}
        <p id="dma-flow-message" class="hidden" role="status" style="margin:0 0 1rem;font-size:0.8125rem;max-width:36rem;line-height:1.4;"></p>
        <div class="dma-panel dma-panel--notice">
          <p>Select a <strong>reporting period</strong> above to start or resume your DMA. Data is stored per user and reporting period.</p>
        </div>
      `;
      return;
    }

    const step = stepFromProfile();
    root.innerHTML = `
      <div class="dma-shell">
        <p id="dma-flow-message" class="hidden" role="status" style="margin:0 0 1rem;font-size:0.8125rem;max-width:36rem;line-height:1.4;"></p>
        <p class="panel-desc dma-ar-note">Top-down DMA only (amended ESRS 1 AR 17). Tool scope: ESRS 2 general disclosures and ESRS E1 climate change (draft ESRS 2.0).</p>
        ${renderProgress()}
        ${step === 1 ? renderStep1() : ""}
        ${step === 2 ? renderStep2() : ""}
        ${step === 3 ? renderStep3() : ""}
        ${step === 4 ? renderStep4() : ""}
      </div>
    `;
    bindStepHandlers(step);
  }

  function readStep1FromDom() {
    const gn = (id) => document.getElementById(id)?.value ?? "";
    companyProfile.companyName = gn("dma-company-name");
    companyProfile.country = gn("dma-country");
    companyProfile.sector = gn("dma-sector");
    companyProfile.companySize = document.getElementById("dma-size")?.value || "medium";
    companyProfile.businessModel = gn("dma-bm");
    companyProfile.valueChain = gn("dma-vc");
  }

  function readStep2FromDom() {
    const e1 = topicAssessments.E1;
    const levelEl = document.querySelector('input[name="e1-level"]:checked');
    e1.level = levelEl ? levelEl.value : null;
    e1.subExpanded = !!document.querySelector(".dma-details[open]");
    E1_SUB_KEYS.forEach((st) => {
      const subEl = document.querySelector(`input[name="e1-sub-${st.key}"]:checked`);
      e1.subtopics[st.key] = subEl ? subEl.value : null;
    });
  }

  function readStep3FromDom() {
    const e1 = topicAssessments.E1;
    const r = document.getElementById("dma-e1-reason");
    const combo = document.getElementById("dma-e1-notmat-combined");
    if (r) e1.reasoning = r.value;
    if (combo) {
      const v = combo.value;
      e1.notMaterialExplanation = v;
      e1.forwardLookingAnalysis = v;
    }
  }

  function readEntitySpecificFromDom() {
    const out = [];
    root.querySelectorAll(".dma-esd-entry").forEach((el) => {
      const id = el.getAttribute("data-esd-id") || "";
      out.push(
        normalizeEntitySpecificEntry({
          id,
          topic: el.querySelector(".dma-esd-topic")?.value ?? "",
          description: el.querySelector(".dma-esd-description")?.value ?? "",
          frameworkEnabled: el.querySelector(".dma-esd-fw")?.checked ?? false,
          frameworkStandard: el.querySelector(".dma-esd-fw-std")?.value ?? "",
          bestPracticesEnabled: el.querySelector(".dma-esd-bp")?.checked ?? false,
          bestPracticesDescription:
            el.querySelector(".dma-esd-bp-desc")?.value ?? "",
        })
      );
    });
    entitySpecificEntries = out;
  }

  function bindStepHandlers(step) {
    if (step === 1) {
      document.getElementById("dma-s1-next")?.addEventListener("click", async () => {
        readStep1FromDom();
        setStep(2);
        await persistPartial({ company_profile: companyProfile });
        render();
      });
    }
    if (step === 2) {
      document.getElementById("dma-s2-back")?.addEventListener("click", async () => {
        readStep2FromDom();
        setStep(1);
        await persistPartial({ topic_assessments: topicAssessments, company_profile: companyProfile });
        render();
      });
      document.getElementById("dma-s2-next")?.addEventListener("click", async () => {
        readStep2FromDom();
        if (!topicAssessments.E1?.level) {
          showDmaInlineMessage(
            "Select materiality for E1 — climate change.",
            "error"
          );
          return;
        }
        if (isE1AllSubtopicsExplicitlyNotMaterial(topicAssessments.E1)) {
          return;
        }
        setStep(3);
        await persistPartial({ topic_assessments: topicAssessments, company_profile: companyProfile });
        render();
      });

      function updateE1SubtopicValidation() {
        const invalid = isE1AllSubtopicsExplicitlyNotMaterial(topicAssessments.E1);
        const msg = document.getElementById("dma-e1-sub-invalid");
        const next = document.getElementById("dma-s2-next");
        if (msg) msg.classList.toggle("hidden", !invalid);
        if (next) next.disabled = invalid;
      }

      function updateE1NotMaterialWarning() {
        const w = document.getElementById("dma-e1-notmat-warning");
        if (!w) return;
        const el = document.querySelector('input[name="e1-level"]:checked');
        const show = el?.value === "not_material";
        w.classList.toggle("hidden", !show);
      }

      function updateE1FurtherAssessmentNote() {
        const n = document.getElementById("dma-e1-further-note");
        if (!n) return;
        const el = document.querySelector('input[name="e1-level"]:checked');
        n.classList.toggle("hidden", el?.value !== E1_REQUIRES_FURTHER_ASSESSMENT);
      }

      document.querySelectorAll('input[name="e1-level"]').forEach((inp) => {
        inp.addEventListener("change", () => {
          const c = document.querySelector('input[name="e1-level"]:checked');
          topicAssessments.E1.level = c ? c.value : null;
          readStep2FromDom();
          updateE1NotMaterialWarning();
          updateE1FurtherAssessmentNote();
          updateE1SubtopicValidation();
        });
      });
      document.querySelectorAll('input[name^="e1-sub-"]').forEach((inp) => {
        inp.addEventListener("change", () => {
          readStep2FromDom();
          updateE1SubtopicValidation();
        });
      });
      updateE1NotMaterialWarning();
      updateE1FurtherAssessmentNote();
      updateE1SubtopicValidation();

      root.querySelectorAll(".dma-mat-clear").forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-mat-name");
          if (!name) return;
          document
            .querySelectorAll(`input[name="${name}"]`)
            .forEach((el) => {
              if (el instanceof HTMLInputElement) el.checked = false;
            });
          if (name === "e1-level") {
            topicAssessments.E1.level = null;
            readStep2FromDom();
            updateE1NotMaterialWarning();
            updateE1FurtherAssessmentNote();
            updateE1SubtopicValidation();
          } else if (name.startsWith("e1-sub-")) {
            const key = name.slice("e1-sub-".length);
            if (topicAssessments.E1.subtopics) {
              topicAssessments.E1.subtopics[key] = null;
            }
            readStep2FromDom();
            updateE1SubtopicValidation();
          }
        });
      });

      document.querySelector(".dma-details")?.addEventListener("toggle", () => {
        const d = document.querySelector(".dma-details");
        if (topicAssessments.E1) topicAssessments.E1.subExpanded = !!d?.open;
        readStep2FromDom();
        updateE1SubtopicValidation();
      });
    }
    if (step === 3) {
      document.getElementById("dma-s3-back")?.addEventListener("click", async () => {
        readStep3FromDom();
        setStep(2);
        await persistPartial({ topic_assessments: topicAssessments, company_profile: companyProfile });
        render();
      });
      document.getElementById("dma-s3-next")?.addEventListener("click", async () => {
        readStep3FromDom();
        drList = withRowIds(buildApplicableDrList(topicAssessments));
        setStep(4);
        await persistPartial({
          topic_assessments: topicAssessments,
          company_profile: companyProfile,
          dr_list: drList,
        });
        render();
      });
      const aiBtnLabel = "Draft reasoning with AI";
      const dmaAiE1 = document.getElementById("dma-ai-e1");
      dmaAiE1?.addEventListener("click", async () => {
        readStep3FromDom();
        const errEl = document.getElementById("dma-ai-e1-error");
        const okEl = document.getElementById("dma-ai-e1-success");
        if (errEl) {
          errEl.textContent = "";
          errEl.classList.add("hidden");
        }
        if (okEl) {
          okEl.textContent = "";
          okEl.classList.add("hidden");
        }
        dmaAiE1.disabled = true;
        dmaAiE1.textContent = "Drafting...";
        try {
          const text = await draftReasoningWithAi(
            companyProfile,
            "E1 Climate change",
            "Material or requires further assessment",
            topicAssessments.E1?.reasoning || ""
          );
          const ta = document.getElementById("dma-e1-reason");
          if (ta) ta.value = text;
          if (errEl) {
            errEl.textContent = "";
            errEl.classList.add("hidden");
          }
          showAiDraftSuccess("dma-ai-e1-success");
        } catch (e) {
          console.error(e);
          if (errEl) {
            errEl.textContent =
              "Could not generate draft. Check your API key and try again.";
            errEl.classList.remove("hidden");
          }
          if (okEl) {
            okEl.textContent = "";
            okEl.classList.add("hidden");
          }
        } finally {
          dmaAiE1.disabled = false;
          dmaAiE1.textContent = aiBtnLabel;
        }
      });
      const dmaAiE1Nm = document.getElementById("dma-ai-e1-nm");
      dmaAiE1Nm?.addEventListener("click", async () => {
        readStep3FromDom();
        const errEl = document.getElementById("dma-ai-e1-nm-error");
        const okEl = document.getElementById("dma-ai-e1-nm-success");
        if (errEl) {
          errEl.textContent = "";
          errEl.classList.add("hidden");
        }
        if (okEl) {
          okEl.textContent = "";
          okEl.classList.add("hidden");
        }
        dmaAiE1Nm.disabled = true;
        dmaAiE1Nm.textContent = "Drafting...";
        try {
          const text = await draftReasoningWithAi(
            companyProfile,
            "E1 Climate change — not material",
            "Not material — detailed explanation and forward-looking analysis required",
            [topicAssessments.E1?.notMaterialExplanation, topicAssessments.E1?.forwardLookingAnalysis].join("\n")
          );
          const ta = document.getElementById("dma-e1-notmat-combined");
          if (ta) ta.value = text;
          if (errEl) {
            errEl.textContent = "";
            errEl.classList.add("hidden");
          }
          showAiDraftSuccess("dma-ai-e1-nm-success");
        } catch (e) {
          console.error(e);
          if (errEl) {
            errEl.textContent =
              "Could not generate draft. Check your API key and try again.";
            errEl.classList.remove("hidden");
          }
          if (okEl) {
            okEl.textContent = "";
            okEl.classList.add("hidden");
          }
        } finally {
          dmaAiE1Nm.disabled = false;
          dmaAiE1Nm.textContent = aiBtnLabel;
        }
      });
    }
    if (step === 4) {
      document.getElementById("dma-s4-back")?.addEventListener("click", async () => {
        readEntitySpecificFromDom();
        setStep(3);
        await persistPartial({
          dr_list: drList,
          company_profile: companyProfile,
        });
        render();
      });
      document.getElementById("dma-s4-save")?.addEventListener("click", async () => {
        readEntitySpecificFromDom();
        status = "completed";
        const ok = await persistPartial({
          dr_list: drList,
          status: "completed",
          company_profile: companyProfile,
        });
        render();
        if (ok) {
          queueMicrotask(() =>
            showDmaInlineMessage("DMA saved.", "success")
          );
        }
      });
      document.getElementById("dma-regen")?.addEventListener("click", async () => {
        readEntitySpecificFromDom();
        drList = withRowIds(buildApplicableDrList(topicAssessments));
        await persistPartial({ dr_list: drList });
        render();
      });
      document.getElementById("dma-download-report")?.addEventListener("click", async () => {
        const rpId = await resolveReportingPeriodId();
        if (!rpId) {
          showDmaInlineMessage("Select a reporting period first.", "info");
          return;
        }
        const yearStr =
          document.getElementById("reporting-period-select")?.value || "";
        const y = parseInt(yearStr, 10);
        const ok = await downloadDmaAssessmentWordReport(
          supabase,
          rpId,
          Number.isFinite(y) ? y : new Date().getFullYear()
        );
        if (!ok) {
          showDmaInlineMessage(
            "Could not download report. Ensure the assessment is saved as completed.",
            "error"
          );
        }
      });
      root.querySelectorAll(".dma-omit-dr").forEach((btn) => {
        btn.addEventListener("click", () => {
          dmaStep4OmitFormRowId = btn.getAttribute("data-dr-id");
          render();
        });
      });
      root.querySelectorAll(".dma-omit-cancel").forEach((btn) => {
        btn.addEventListener("click", () => {
          dmaStep4OmitFormRowId = null;
          render();
        });
      });
      root.querySelectorAll(".dma-omit-confirm").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const rowId = btn.getAttribute("data-dr-id") || "";
          const formTr = btn.closest("tr.dma-omit-form-row");
          const reason =
            formTr?.querySelector(".dma-omit-reason-select")?.value?.trim() || "";
          const just =
            formTr?.querySelector(".dma-omit-justification")?.value?.trim() ||
            "";
          const errP = formTr?.querySelector(".dma-omit-form-err");
          if (!reason) {
            if (errP) {
              errP.textContent = "Select a reason for omission.";
              errP.classList.remove("hidden");
            }
            return;
          }
          if (!just) {
            if (errP) {
              errP.textContent = "Justification is required.";
              errP.classList.remove("hidden");
            }
            return;
          }
          if (errP) {
            errP.textContent = "";
            errP.classList.add("hidden");
          }
          const dr = drList.find((r) => String(r.id) === String(rowId));
          if (dr) {
            dr.omitted = true;
            dr.omissionReason = reason;
            dr.omissionJustification = just;
          }
          dmaStep4OmitFormRowId = null;
          readEntitySpecificFromDom();
          await persistPartial({ dr_list: drList });
          render();
        });
      });
      root.querySelectorAll(".dma-undo-omit").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const rowId = btn.getAttribute("data-dr-id") || "";
          const dr = drList.find((r) => String(r.id) === String(rowId));
          if (dr) {
            dr.omitted = false;
            delete dr.omissionReason;
            delete dr.omissionJustification;
          }
          readEntitySpecificFromDom();
          await persistPartial({ dr_list: drList });
          render();
        });
      });
      document.getElementById("dma-esd-add")?.addEventListener("click", async () => {
        readEntitySpecificFromDom();
        entitySpecificEntries.push(newEntitySpecificEntry());
        await persistPartial({ company_profile: companyProfile });
        render();
      });
      root.querySelectorAll(".dma-esd-remove").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const esdId = btn.getAttribute("data-esd-id") || "";
          readEntitySpecificFromDom();
          entitySpecificEntries = entitySpecificEntries.filter(
            (e) => e.id !== esdId
          );
          await persistPartial({ company_profile: companyProfile });
          render();
        });
      });
      root.querySelectorAll(".dma-esd-fw").forEach((cb) => {
        cb.addEventListener("change", () => {
          const wrap = cb
            .closest(".dma-esd-entry")
            ?.querySelector(".dma-esd-fw-wrap");
          wrap?.classList.toggle("hidden", !cb.checked);
        });
      });
      root.querySelectorAll(".dma-esd-bp").forEach((cb) => {
        cb.addEventListener("change", () => {
          const wrap = cb
            .closest(".dma-esd-entry")
            ?.querySelector(".dma-esd-bp-wrap");
          wrap?.classList.toggle("hidden", !cb.checked);
        });
      });
      root.querySelectorAll(".dma-dr-col-toggle").forEach((cb) => {
        cb.addEventListener("change", () => {
          const k = cb.getAttribute("data-dr-col-toggle");
          if (k && Object.prototype.hasOwnProperty.call(step4ColumnVisibility, k)) {
            step4ColumnVisibility[k] = cb.checked;
            applyStep4ColumnVisibility();
          }
        });
      });
    }
  }

  const sel = document.getElementById("reporting-period-select");
  sel?.addEventListener("change", () => void loadAssessment());

  void loadAssessment();
}
