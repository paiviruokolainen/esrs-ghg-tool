/**
 * Gap Assessment — compares uploaded sustainability report PDF to approved DMA DR list (amended ESRS 2.0).
 */

import OpenAI from "openai";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

let gapToastTimer = 0;
let gapSaveSuccessClearTimer = 0;
/** @param {string} msg */
function showGapToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(gapToastTimer);
  gapToastTimer = setTimeout(() => t.classList.remove("visible"), 2600);
}

const BATCH_SIZE = 10;
const MAX_REPORT_CHARS = 200000;
const MAX_PDF_PAGES_WARN = 50;
const ESRS_CHUNKS_VERSION = "amended-2025";
const ESRS_REQUIREMENT_SNIPPET_LEN = 1500;

/** Informational: legacy vs amended 2.0 — E1 & ESRS 2 scope (not evaluated as DR gaps). */
const CAN_DROP_ITEMS = [
  {
    title: "Redundant cross-walks to superseded EFRAG IG annexes",
    detail:
      "Amended ESRS 2.0 integrates cross-cutting expectations; standalone mapping tables to old annexes are often unnecessary.",
  },
  {
    title: "Duplicate climate transition narrative",
    detail:
      "Where amended E1 consolidates mitigation policies, actions, and targets, separate boilerplate chapters may overlap one disclosure thread.",
  },
  {
    title: "Facility-level energy intensity where consolidated metrics suffice",
    detail:
      "If your approved DR set uses undertaking-level E1 energy and GHG metrics, site-by-site breakdowns may be optional for your materiality profile.",
  },
  {
    title: "Legacy Scope 3 category tables beyond material categories",
    detail:
      "Under a top-down DMA, immaterial value-chain categories need not be reported at full category granularity.",
  },
  {
    title: "Standalone physical risk tables if narrative meets E1 resilience DR",
    detail:
      "Detailed scenario tables are only needed where material; amended E1-3 allows proportionate resilience disclosure.",
  },
  {
    title: "Repeated ESRS 2 governance boilerplate across subsidiaries",
    detail:
      "Group-level sustainability statements often satisfy GOV/SBM DRs without duplicating identical text per entity.",
  },
];

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
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

function normalizeCompanyProfile(raw) {
  const d = defaultCompanyProfile();
  if (!raw || typeof raw !== "object") return d;
  return { ...d, ...raw };
}

function getOpenAI() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing VITE_OPENAI_API_KEY.");
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
}

/**
 * @param {File} file
 * @param {(done: number, total: number) => void} onProgress
 */
async function extractPdfText(file, onProgress) {
  const pdfjsLib = window.pdfjsLib || window.pdfjs;
  if (!pdfjsLib?.getDocument) {
    throw new Error("PDF.js did not load. Check the script tag and network.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const total = pdf.numPages;
  let full = "";
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item) =>
      "str" in item ? item.str : ""
    );
    full += `${strings.join(" ")}\n\n`;
    onProgress(i, total);
  }
  return { text: full.trim(), pageCount: total };
}

function truncateReportText(text) {
  if (text.length <= MAX_REPORT_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_REPORT_CHARS)}\n\n[… Report truncated for evaluation length limit …]`,
    truncated: true,
  };
}

/**
 * Try to isolate sustainability-related content from full PDF text using common section headers.
 * @param {string} fullText
 * @returns {{ text: string, usedSection: boolean }}
 */
function extractSustainabilitySection(fullText) {
  const t = fullText.replace(/\r\n/g, "\n");
  if (!t.trim()) return { text: t, usedSection: false };

  const lower = t.toLowerCase();
  let startIdx = -1;

  for (const p of ["sustainability statement", "sustainability reporting"]) {
    const i = lower.indexOf(p);
    if (i !== -1 && (startIdx === -1 || i < startIdx)) startIdx = i;
  }

  const esrsMatch = /\bESRS\b/.exec(t);
  if (esrsMatch) {
    const i = esrsMatch.index;
    if (startIdx === -1 || i < startIdx) startIdx = i;
  }

  if (startIdx === -1) {
    return { text: t, usedSection: false };
  }

  let sliceStart = startIdx;
  const lineStart = t.lastIndexOf("\n", startIdx);
  if (lineStart !== -1 && startIdx - lineStart <= 200) {
    sliceStart = lineStart + 1;
  }

  const after = t.slice(sliceStart);
  const minEndOffset = 300;
  const endPatterns = [
    /\n\s*(?:Consolidated\s+)?financial\s+statements\b/i,
    /\n\s*Independent\s+(?:auditor|auditors)\b/i,
    /\n\s*Financial\s+statements\b/i,
    /\n\s*Report\s+of\s+the\s+[Aa]udit(?:or)?s?\b/i,
    /\n\s*Remuneration\s+report\b/i,
  ];

  let endRel = -1;
  for (const re of endPatterns) {
    const match = re.exec(after);
    if (match && match.index >= minEndOffset) {
      if (endRel === -1 || match.index < endRel) endRel = match.index;
    }
  }

  const sliceEnd = endRel === -1 ? t.length : sliceStart + endRel;
  const section = t.slice(sliceStart, sliceEnd).trim();

  if (section.length < 400) {
    return { text: t, usedSection: false };
  }

  return { text: section, usedSection: true };
}

function parseEvaluationJsonArray(content) {
  const trimmed = content.trim();
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Model did not return a JSON array.");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error("Parsed JSON is not an array.");
  return parsed;
}

function normalizeStatus(s) {
  const x = String(s || "").toLowerCase();
  if (x === "present" || x === "partial" || x === "missing") return x;
  return "missing";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} drRefs
 * @returns {Promise<Map<string, { title: string, content: string }>>}
 */
async function fetchEsrsChunksLookup(supabase, drRefs) {
  const unique = [...new Set(drRefs.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("esrs_chunks")
    .select("disclosure_requirement, standard, title, content")
    .eq("version", ESRS_CHUNKS_VERSION)
    .in("disclosure_requirement", unique);

  if (error) {
    console.error("gap esrs_chunks:", error);
    return new Map();
  }

  const map = new Map();
  for (const row of data ?? []) {
    const ref = row.disclosure_requirement;
    if (ref == null || ref === "") continue;
    if (!map.has(ref)) {
      map.set(ref, {
        title: row.title != null ? String(row.title) : "",
        content: row.content != null ? String(row.content) : "",
      });
    }
  }
  return map;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} ref
 * @returns {Promise<{ title: string, content: string } | null>}
 */
async function fetchEsrsChunkForAsk(supabase, ref) {
  const { data, error } = await supabase
    .from("esrs_chunks")
    .select("title, content")
    .eq("disclosure_requirement", ref)
    .eq("version", ESRS_CHUNKS_VERSION)
    .limit(1);
  if (error) {
    console.error("gap esrs_chunks ask:", error);
    return null;
  }
  return data?.[0] ?? null;
}

/**
 * @param {{ ref: string, title: string, standard: string }[]} drBatch
 * @param {Map<string, { title: string, content: string }>} chunkByRef
 */
function buildEsrsRequirementTextSection(drBatch, chunkByRef) {
  let block = `ESRS 2.0 REQUIREMENT TEXT:
For each DR below, here is the actual amended ESRS 2.0 
requirement text to evaluate against:

`;
  for (const r of drBatch) {
    const row = chunkByRef.get(r.ref);
    const titleLine = (row?.title && row.title.trim()) || r.title;
    let body;
    if (row?.content != null && String(row.content).trim() !== "") {
      body = String(row.content).slice(0, ESRS_REQUIREMENT_SNIPPET_LEN);
    } else {
      body =
        "(No official ESRS requirement text found in the database for this DR. Evaluate using the DR title only and mention in your explanation that the official requirement text was not available.)";
    }
    block += `${r.ref} - ${titleLine}:\n${body}\n\n---\n\n`;
  }
  return block.trimEnd();
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function resolveReportingPeriodId(supabase) {
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
    console.error("gap reporting_periods:", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * @param {{
 *   companyProfile: ReturnType<typeof normalizeCompanyProfile>,
 *   drBatch: { ref: string, title: string, standard: string }[],
 *   reportText: string,
 *   chunkByRef: Map<string, { title: string, content: string }>,
 * }} opts
 */
async function evaluateDrBatch({
  companyProfile,
  drBatch,
  reportText,
  chunkByRef,
}) {
  const openai = getOpenAI();
  const map = chunkByRef instanceof Map ? chunkByRef : new Map();
  const drList = drBatch
    .map((r) => `- ${r.ref}: ${r.title} (${r.standard})`)
    .join("\n");

  const esrsSection = buildEsrsRequirementTextSection(drBatch, map);

  const userMsg = `Company: ${companyProfile.companyName || "—"}, ${companyProfile.sector || "—"}, ${companyProfile.country || "—"}

Evaluate whether the following sustainability report adequately covers each disclosure requirement. For each DR respond with:
- status: "present", "partial", or "missing"
- explanation: 1-2 sentences of evidence or reason for the assessment. If no official requirement text was provided in the ESRS section below for a DR, evaluate from the DR title only and state briefly in the explanation that the official requirement text was not available.

Disclosure requirements to evaluate:
${drList}

${esrsSection}

Sustainability report text:
${reportText}

Respond ONLY with a JSON array:
[
  {
    "ref": "DR reference",
    "status": "present|partial|missing",
    "explanation": "evidence or reason"
  }
]`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a CSRD compliance expert evaluating a sustainability 
report against the actual amended ESRS 2.0 disclosure 
requirements provided below. Base your evaluation strictly 
on the requirement text provided, not on general knowledge 
of ESRS.`,
      },
      { role: "user", content: userMsg },
    ],
    temperature: 0.2,
  });

  const raw = res.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty response from model.");
  const arr = parseEvaluationJsonArray(raw);
  return arr.map((row) => ({
    ref: String(row.ref ?? "").trim(),
    status: normalizeStatus(row.status),
    explanation: String(row.explanation ?? "").trim() || "—",
  }));
}

/**
 * @param {{
 *   summary: { present: number, partial: number, missing: number, canDrop: number },
 *   rows: { ref: string, title: string, standard: string, status: string, explanation: string }[],
 *   companyName: string,
 * }} opts
 */
async function buildGapDocxBlob({ summary, rows, companyName }) {
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun("Gap Assessment Report")],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(companyName || "—")],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(`Date: ${dateStr}`)],
    }),
    new Paragraph({
      children: [new TextRun("")],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Executive summary")],
    }),
    new Paragraph({
      children: [
        new TextRun(
          `Present: ${summary.present}. Partial: ${summary.partial}. Missing: ${summary.missing}.`
        ),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Full results")],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ["DR Reference", "Title", "Standard", "Status", "Explanation"].map(
            (h) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: h, bold: true })],
                  }),
                ],
              })
          ),
        }),
        ...rows.map(
          (r) =>
            new TableRow({
              children: [r.ref, r.title, r.standard, r.status, r.explanation].map(
                (c) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun(String(c ?? "—"))],
                      }),
                    ],
                  })
              ),
            })
        ),
      ],
    }),
    new Paragraph({
      children: [new TextRun("")],
    }),
    new Paragraph({
      children: [
        new TextRun({
          italics: true,
          text: "Based on amended ESRS 2.0 draft standards.",
        }),
      ],
    }),
  ];

  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export function initGapAssessment(supabase) {
  const root = document.getElementById("gap-root");
  if (!root) return;

  /** @type {{
   *   dmaCompleted: boolean | null,
   *   phase: "idle" | "extracting" | "evaluating" | "done" | "error",
   *   file: File | null,
   *   fileName: string,
   *   extractProgress: string,
   *   evalProgress: string,
   *   reportText: string,
   *   pageCount: number,
   *   companyProfile: ReturnType<typeof normalizeCompanyProfile> | null,
   *   drRows: { ref: string, title: string, standard: string, omitted?: boolean }[],
   *   evaluations: { ref: string, title: string, standard: string, status: string, explanation: string }[],
   *   failedBatches: { index: number, refs: string[], message: string }[],
   *   errorMessage: string,
   *   saving: boolean,
   *   extractionNote: string,
   *   esrsChunkByRef: Map<string, { title: string, content: string }> | null,
   *   saveSuccessMessage: string,
   *   askOpenRef: string | null,
   *   askDraftByRef: Record<string, string>,
   *   askResponseByRef: Record<string, string>,
   *   askLoading: boolean,
   * }} */
  const state = {
    dmaCompleted: null,
    phase: "idle",
    file: null,
    fileName: "",
    extractProgress: "",
    evalProgress: "",
    reportText: "",
    pageCount: 0,
    companyProfile: null,
    drRows: [],
    evaluations: [],
    failedBatches: [],
    errorMessage: "",
    saving: false,
    extractionNote: "",
    esrsChunkByRef: null,
    saveSuccessMessage: "",
    askOpenRef: null,
    askDraftByRef: {},
    askResponseByRef: {},
    askLoading: false,
  };

  async function checkDma() {
    state.dmaCompleted = null;
    const rpId = await resolveReportingPeriodId(supabase);
    if (!rpId) {
      state.dmaCompleted = false;
      return;
    }
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) {
      state.dmaCompleted = false;
      return;
    }
    const { data, error } = await supabase
      .from("dma_assessments")
      .select("status")
      .eq("reporting_period_id", rpId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error) {
      console.error("gap dma check:", error);
      state.dmaCompleted = false;
      return;
    }
    state.dmaCompleted = data?.status === "completed";
  }

  async function loadDrContext() {
    const rpId = await resolveReportingPeriodId(supabase);
    state.companyProfile = null;
    state.drRows = [];
    if (!rpId) return;
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) return;
    const { data, error } = await supabase
      .from("dma_assessments")
      .select("company_profile, dr_list")
      .eq("reporting_period_id", rpId)
      .eq("user_id", userData.user.id)
      .eq("status", "completed")
      .maybeSingle();
    if (error || !data) {
      console.error("gap dma fetch:", error);
      return;
    }
    state.companyProfile = normalizeCompanyProfile(data.company_profile);
    const list = Array.isArray(data.dr_list) ? data.dr_list : [];
    state.drRows = list.filter((r) => !r.omitted);
  }

  function resetRun() {
    state.phase = "idle";
    state.file = null;
    state.fileName = "";
    state.extractProgress = "";
    state.evalProgress = "";
    state.reportText = "";
    state.pageCount = 0;
    state.evaluations = [];
    state.failedBatches = [];
    state.errorMessage = "";
    state.extractionNote = "";
    state.esrsChunkByRef = null;
    state.saveSuccessMessage = "";
    state.askOpenRef = null;
    state.askDraftByRef = {};
    state.askResponseByRef = {};
    state.askLoading = false;
    const input = document.getElementById("gap-pdf-input");
    if (input) input.value = "";
  }

  async function askAboutDr(ref, question) {
    const row = state.evaluations.find((e) => e.ref === ref);
    const title = row?.title ?? "";
    state.askLoading = true;
    render();
    try {
      const chunk = await fetchEsrsChunkForAsk(supabase, ref);
      const chunkContent =
        chunk?.content != null && String(chunk.content).trim() !== ""
          ? String(chunk.content)
          : "(No requirement text found in database.)";
      const chunkTitle =
        chunk?.title != null && String(chunk.title).trim() !== ""
          ? String(chunk.title)
          : title;
      const openai = getOpenAI();
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a CSRD expert. Answer questions about specific ESRS 2.0 disclosure requirements based only on the requirement text provided. Be concise and practical.",
          },
          {
            role: "user",
            content: `Requirement: ${ref} - ${chunkTitle}\n\nRequirement text:\n${chunkContent}\n\nQuestion: ${question}`,
          },
        ],
        temperature: 0.3,
      });
      const text = res.choices?.[0]?.message?.content?.trim() ?? "";
      state.askResponseByRef[ref] = text;
    } catch (e) {
      console.error(e);
      state.askResponseByRef[ref] =
        e instanceof Error ? e.message : "Could not get an answer.";
    } finally {
      state.askLoading = false;
      render();
    }
  }

  function bindGapAskHandlers() {
    root.querySelectorAll(".gap-dr-ask-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ref = btn.getAttribute("data-gap-ask-ref");
        if (!ref) return;
        if (state.askOpenRef === ref) {
          state.askOpenRef = null;
        } else {
          state.askOpenRef = ref;
        }
        render();
      });
    });
    const panel = root.querySelector(".gap-dr-ask-panel");
    if (!panel || !state.askOpenRef) return;
    const ref = state.askOpenRef;
    const inputEl = panel.querySelector(".gap-dr-ask-input");
    panel.querySelector(".gap-dr-ask-close")?.addEventListener("click", () => {
      state.askOpenRef = null;
      render();
    });
    inputEl?.addEventListener("input", () => {
      if (ref && inputEl) state.askDraftByRef[ref] = inputEl.value;
    });
    panel.querySelector(".gap-dr-ask-send")?.addEventListener("click", () => {
      if (inputEl) state.askDraftByRef[ref] = inputEl.value;
      const q = (state.askDraftByRef[ref] ?? "").trim();
      if (!q) return;
      void askAboutDr(ref, q);
    });
  }

  async function runEvaluation() {
    state.errorMessage = "";
    state.failedBatches = [];
    if (!state.file || state.drRows.length === 0) {
      state.errorMessage = "No DR list to evaluate.";
      state.phase = "error";
      render();
      return;
    }

    state.phase = "extracting";
    state.extractProgress = "Extracting text from PDF…";
    render();

    try {
      const { text, pageCount } = await extractPdfText(state.file, (done, total) => {
        state.extractProgress = `Extracting page ${done} of ${total}…`;
        render();
      });
      state.pageCount = pageCount;
      if (pageCount > MAX_PDF_PAGES_WARN) {
        state.extractProgress = `Warning: PDF has ${pageCount} pages (recommended max ${MAX_PDF_PAGES_WARN}). Continuing…`;
        render();
      }
      const sectionResult = extractSustainabilitySection(text);
      const { text: reportText } = truncateReportText(sectionResult.text);
      state.reportText = reportText;
      state.extractionNote = `Extracted ${pageCount} pages. ${
        sectionResult.usedSection
          ? "Using sustainability statement section."
          : "Using full document."
      }`;
    } catch (e) {
      console.error(e);
      state.phase = "error";
      state.errorMessage =
        e instanceof Error
          ? e.message
          : "Could not read the PDF. Try another file or check file integrity.";
      render();
      return;
    }

    state.phase = "evaluating";
    const drRefs = state.drRows.map((r) => r.ref);
    state.esrsChunkByRef = await fetchEsrsChunksLookup(supabase, drRefs);

    const batches = [];
    for (let i = 0; i < state.drRows.length; i += BATCH_SIZE) {
      batches.push(state.drRows.slice(i, i + BATCH_SIZE));
    }

    const byRef = new Map();
    const failed = [];
    let evaluatedCount = 0;
    const total = state.drRows.length;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const refs = batch.map((r) => r.ref);
      state.evalProgress = `Evaluating ${Math.min(evaluatedCount + batch.length, total)} of ${total} disclosure requirements…`;
      render();

      try {
        const results = await evaluateDrBatch({
          companyProfile: state.companyProfile || normalizeCompanyProfile({}),
          drBatch: batch.map((r) => ({
            ref: r.ref,
            title: r.title,
            standard: r.standard,
          })),
          reportText: state.reportText,
          chunkByRef: state.esrsChunkByRef ?? new Map(),
        });

        const resultByRef = new Map(results.map((r) => [r.ref, r]));
        for (const dr of batch) {
          const ev = resultByRef.get(dr.ref);
          if (!ev) {
            failed.push({
              index: bi,
              refs: [dr.ref],
              message: "Model did not return an entry for this DR.",
            });
            continue;
          }
          byRef.set(dr.ref, {
            ref: dr.ref,
            title: dr.title,
            standard: dr.standard,
            status: ev.status,
            explanation: ev.explanation,
          });
        }
        evaluatedCount += batch.length;
      } catch (e) {
        console.error(e);
        failed.push({
          index: bi,
          refs,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    state.failedBatches = failed;
    state.evaluations = state.drRows.map((dr) => {
      const got = byRef.get(dr.ref);
      if (got) return got;
      return {
        ref: dr.ref,
        title: dr.title,
        standard: dr.standard,
        status: "missing",
        explanation: "Could not be evaluated (batch error). Use Retry failed batches.",
      };
    });

    state.phase = "done";
    render();
  }

  async function saveResults() {
    const rpId = await resolveReportingPeriodId(supabase);
    if (!rpId) return;
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) return;

    state.saving = true;
    state.saveSuccessMessage = "";
    render();

    const summary = computeSummary(state.evaluations);
    const payload = {
      evaluations: state.evaluations,
      failedBatches: state.failedBatches,
      pdfFileName: state.fileName,
      reportTextLength: state.reportText.length,
      pageCount: state.pageCount,
      extractionNote: state.extractionNote,
      summary,
      evaluatedAt: new Date().toISOString(),
    };

    const { error } = await supabase.from("gap_assessments").upsert(
      {
        user_id: userData.user.id,
        reporting_period_id: rpId,
        results: payload,
      },
      { onConflict: "user_id,reporting_period_id" }
    );

    state.saving = false;
    render();

    if (error) {
      console.error("gap save:", error);
      state.saveSuccessMessage = "";
      state.errorMessage = error.message || "Could not save results.";
      render();
      return;
    }
    state.errorMessage = "";
    state.saveSuccessMessage = "Results saved";
    render();
    clearTimeout(gapSaveSuccessClearTimer);
    gapSaveSuccessClearTimer = setTimeout(() => {
      state.saveSuccessMessage = "";
      render();
    }, 2800);
  }

  async function downloadReport() {
    const summary = computeSummary(state.evaluations);
    try {
      const blob = await buildGapDocxBlob({
        summary,
        rows: state.evaluations,
        companyName: state.companyProfile?.companyName || "",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gap-assessment-${new Date().toISOString().slice(0, 10)}.docx`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      state.errorMessage =
        e instanceof Error ? e.message : "Could not build Word report.";
      render();
    }
  }

  function computeSummary(evals) {
    let present = 0;
    let partial = 0;
    let missing = 0;
    for (const e of evals) {
      if (e.status === "present") present++;
      else if (e.status === "partial") partial++;
      else missing++;
    }
    return {
      present,
      partial,
      missing,
      canDrop: CAN_DROP_ITEMS.length,
    };
  }

  /**
   * @param {import("@supabase/supabase-js").SupabaseClient} supabase
   * @param {string} rpId
   */
  async function fetchSavedGapAssessment(supabase, rpId) {
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData?.user) return null;
    const { data, error } = await supabase
      .from("gap_assessments")
      .select("results")
      .eq("reporting_period_id", rpId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error) {
      console.error("gap_assessments load:", error);
      return null;
    }
    return data;
  }

  /**
   * @param {Record<string, unknown>} results
   */
  function hydrateFromSaved(results) {
    const raw = results?.evaluations;
    if (!Array.isArray(raw)) return false;
    state.phase = "done";
    state.file = null;
    state.fileName =
      typeof results.pdfFileName === "string" ? results.pdfFileName : "";
    state.extractProgress = "";
    state.evalProgress = "";
    state.reportText = "";
    state.pageCount =
      typeof results.pageCount === "number" && Number.isFinite(results.pageCount)
        ? results.pageCount
        : 0;
    state.evaluations = raw.map((e) => ({
      ref: String(e?.ref ?? "").trim(),
      title: String(e?.title ?? "").trim(),
      standard: String(e?.standard ?? "").trim(),
      status: normalizeStatus(e?.status),
      explanation: String(e?.explanation ?? "").trim() || "—",
    }));
    state.failedBatches = Array.isArray(results.failedBatches)
      ? results.failedBatches
      : [];
    state.errorMessage = "";
    state.extractionNote =
      typeof results.extractionNote === "string" ? results.extractionNote : "";
    state.esrsChunkByRef = null;
    state.saveSuccessMessage = "";
    state.saving = false;
    state.askOpenRef = null;
    state.askDraftByRef = {};
    state.askResponseByRef = {};
    state.askLoading = false;
    return true;
  }

  /**
   * @param {{ showResultsLayout: boolean }} opts When true, compact upload (file + name only) and "Run new assessment" as run trigger above results.
   */
  function gapUploadSectionHtml(opts) {
    const showResultsLayout = opts.showResultsLayout === true;
    const drCount = state.drRows.length;
    const noDrs = drCount === 0;
    const canRun = Boolean(state.file) && !noDrs;
    if (showResultsLayout) {
      const runNewBlock = `<div class="gap-run-new-wrap" style="margin-top:0.75rem;"><button type="button" class="btn btn-secondary" id="gap-run-new-above" ${canRun ? "" : "disabled"}>Run new assessment</button></div>`;
      return `
      <div class="gap-upload panel">
        <label class="gap-upload-label" for="gap-pdf-input">Upload your sustainability report</label>
        <div class="gap-upload-zone">
          <input type="file" id="gap-pdf-input" accept=".pdf,application/pdf" class="gap-file-input" ${noDrs ? "disabled" : ""} />
          <p class="gap-file-name" id="gap-file-name">${state.fileName ? escapeHtml(state.fileName) : "No file selected"}</p>
        </div>
      </div>${runNewBlock}`;
    }
    return `
      <div class="gap-upload panel">
        <label class="gap-upload-label" for="gap-pdf-input">Upload your sustainability report</label>
        <div class="gap-upload-zone">
          <input type="file" id="gap-pdf-input" accept=".pdf,application/pdf" class="gap-file-input" ${noDrs ? "disabled" : ""} />
          <p class="gap-file-name" id="gap-file-name">${state.fileName ? escapeHtml(state.fileName) : "No file selected"}</p>
        </div>
        <p class="gap-upload-hint">Supported format: PDF. Large documents are supported — the tool will automatically extract the sustainability statement section if present.</p>
        <p class="gap-dr-count">${drCount} disclosure requirement(s) will be evaluated (non-omitted DRs from your DMA).</p>
        ${noDrs ? `<p class="gap-warn" role="status">No non-omitted disclosure requirements found in your DMA for this period. Complete and approve your DMA first.</p>` : ""}
        <button type="button" class="btn btn-primary" id="gap-run" ${canRun ? "" : "disabled"}>Run gap assessment</button>
      </div>`;
  }

  function attachGapUploadListeners() {
    const input = document.getElementById("gap-pdf-input");
    const runBtn = document.getElementById("gap-run");
    const runNewBtn = document.getElementById("gap-run-new-above");
    const noDrs = state.drRows.length === 0;
    input?.addEventListener("change", () => {
      const f = input.files?.[0];
      state.file = f || null;
      state.fileName = f?.name || "";
      const nameEl = document.getElementById("gap-file-name");
      if (nameEl) nameEl.textContent = state.fileName || "No file selected";
      const ok = Boolean(state.file) && !noDrs;
      if (runBtn) runBtn.disabled = !ok;
      if (runNewBtn) runNewBtn.disabled = !ok;
    });
    runBtn?.addEventListener("click", () => runEvaluation());
    runNewBtn?.addEventListener("click", () => runEvaluation());
  }

  function render() {
    const dmaOk = state.dmaCompleted === true;
    const dmaUnknown = state.dmaCompleted === null;

    if (dmaUnknown) {
      root.innerHTML = `<p class="gap-loading">Checking prerequisites…</p>`;
      return;
    }

    if (!dmaOk) {
      root.innerHTML = `
        <div class="gap-prereq panel gap-panel-notice">
          <p>A completed Double Materiality Assessment is required before running a gap assessment. Please complete your DMA first.</p>
          <p><button type="button" class="btn btn-primary gap-link-dma" data-gap-go-dma>Go to Double Materiality Assessment</button></p>
        </div>`;
      root.querySelector("[data-gap-go-dma]")?.addEventListener("click", () => {
        document.querySelector('.nav-btn[data-nav="csrd-assistant"]')?.click();
      });
      return;
    }

    if (state.phase === "extracting" || state.phase === "evaluating") {
      const noteBlock =
        state.phase === "evaluating" && state.extractionNote
          ? `<p style="margin:0 0 0.75rem;font-size:0.8125rem;color:#475569;line-height:1.45;max-width:48rem;" role="status">${escapeHtml(state.extractionNote)}</p>`
          : "";
      root.innerHTML = `
        <div class="gap-step gap-panel">
          ${noteBlock}
          <p class="gap-progress-msg" role="status">${escapeHtml(
            state.phase === "extracting"
              ? state.extractProgress
              : state.evalProgress
          )}</p>
          <div class="gap-progress-bar" aria-hidden="true"><div class="gap-progress-bar-fill"></div></div>
        </div>`;
      return;
    }

    if (state.phase === "done" || (state.phase === "error" && state.evaluations.length)) {
      const summary = computeSummary(state.evaluations);
      const missingRows = state.evaluations.filter((e) => e.status === "missing");
      const partialRows = state.evaluations.filter((e) => e.status === "partial");
      const presentRows = state.evaluations.filter((e) => e.status === "present");

      const table = (rows, cls) =>
        rows.length === 0
          ? `<p class="gap-empty">None</p>`
          : `<div class="gap-table-wrap"><table class="gap-table ${cls}">
            <thead><tr><th>DR Reference</th><th>Title</th><th>Standard</th><th>Explanation</th></tr></thead>
            <tbody>${rows
              .map(
                (r) =>
                  `<tr><td>${escapeHtml(r.ref)}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.standard)}</td><td>${escapeHtml(r.explanation)}</td></tr>`
              )
              .join("")}</tbody>
          </table></div>`;

      const tableWithAsk = (rows, cls) => {
        if (rows.length === 0) return `<p class="gap-empty">None</p>`;
        const body = rows
          .map((r) => {
            const ref = r.ref;
            const isOpen = state.askOpenRef === ref;
            const draft = state.askDraftByRef[ref] ?? "";
            const resp = state.askResponseByRef[ref] ?? "";
            const showLoading = state.askLoading && isOpen;
            const respHtml = showLoading
              ? '<p class="gap-dr-ask-status">Thinking…</p>'
              : resp
                ? `<div class="gap-dr-ask-response-text">${escapeHtml(resp).replace(/\n/g, "<br />")}</div>`
                : "";
            const chatRow = isOpen
              ? `<tr class="gap-dr-ask-chat-row"><td colspan="5">
              <div class="gap-dr-ask-panel">
                <div class="gap-dr-ask-toolbar">
                  <input type="text" class="gap-dr-ask-input" placeholder="Ask about this requirement..." value="${escapeHtml(draft)}" autocomplete="off" />
                  <button type="button" class="btn btn-primary btn-compact gap-dr-ask-send">Send</button>
                  <button type="button" class="btn btn-secondary btn-compact gap-dr-ask-close">Close</button>
                </div>
                <div class="gap-dr-ask-response" aria-live="polite">${respHtml}</div>
              </div>
            </td></tr>`
              : "";
            return `<tr class="gap-dr-data-row">
              <td>${escapeHtml(ref)}</td>
              <td>${escapeHtml(r.title)}</td>
              <td>${escapeHtml(r.standard)}</td>
              <td>${escapeHtml(r.explanation)}</td>
              <td class="gap-dr-ask-cell"><button type="button" class="btn btn-secondary btn-compact gap-dr-ask-btn" data-gap-ask-ref="${escapeHtml(ref)}">Ask</button></td>
            </tr>${chatRow}`;
          })
          .join("");
        return `<div class="gap-table-wrap"><table class="gap-table ${cls}">
            <thead><tr><th>DR Reference</th><th>Title</th><th>Standard</th><th>Explanation</th><th></th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>`;
      };

      const failedHtml =
        state.failedBatches.length > 0
          ? `<div class="gap-failed panel gap-panel-warn" role="alert">
            <p><strong>Some batches could not be evaluated:</strong></p>
            <ul class="gap-failed-list">${state.failedBatches
              .map(
                (f) =>
                  `<li>${escapeHtml(f.refs.join(", "))}: ${escapeHtml(f.message)}</li>`
              )
              .join("")}</ul>
            <button type="button" class="btn btn-secondary" id="gap-retry-failed">Retry failed batches</button>
          </div>`
          : "";

      root.innerHTML = `
        <div style="margin-bottom:1.25rem;">${gapUploadSectionHtml({ showResultsLayout: true })}</div>
        ${state.saveSuccessMessage ? `<p style="margin:0 0 0.75rem;padding:0.55rem 0.75rem;border-radius:6px;font-size:0.875rem;background:#f0fdf4;border:1px solid #86efac;color:#166534;line-height:1.4;max-width:40rem;" role="status">${escapeHtml(state.saveSuccessMessage)}</p>` : ""}
        ${state.errorMessage ? `<p class="gap-inline-error" role="alert">${escapeHtml(state.errorMessage)}</p>` : ""}
        ${failedHtml}
        ${state.extractionNote ? `<p style="margin:0 0 0.75rem;font-size:0.8125rem;color:#475569;line-height:1.45;max-width:48rem;">${escapeHtml(state.extractionNote)}</p>` : ""}
        <div class="gap-summary-cards">
          <div class="gap-summary-card gap-summary-card--present"><span class="gap-summary-label">Present</span><span class="gap-summary-num">${summary.present}</span></div>
          <div class="gap-summary-card gap-summary-card--partial"><span class="gap-summary-label">Partial</span><span class="gap-summary-num">${summary.partial}</span></div>
          <div class="gap-summary-card gap-summary-card--missing"><span class="gap-summary-label">Missing</span><span class="gap-summary-num">${summary.missing}</span></div>
          <div class="gap-summary-card gap-summary-card--drop"><span class="gap-summary-label">Can drop</span><span class="gap-summary-num">${summary.canDrop}</span></div>
        </div>
        <p style="margin:0 0 1rem;font-size:0.8125rem;color:#64748b;font-style:italic;line-height:1.45;max-width:48rem;">Results are AI-generated and may vary between runs. Always review explanations before using results for reporting purposes.</p>

        <h3 class="gap-section-title gap-section-title--missing">Missing</h3>
        ${tableWithAsk(missingRows, "gap-table--missing")}

        <h3 class="gap-section-title gap-section-title--partial">Partial</h3>
        ${tableWithAsk(partialRows, "gap-table--partial")}

        <h3 class="gap-section-title gap-section-title--present">Present</h3>
        ${table(presentRows, "gap-table--present")}

        <section class="gap-can-drop panel">
          <h3 class="gap-can-drop-heading">Previously reported — no longer required under amended ESRS 2.0</h3>
          <p class="gap-can-drop-intro">The following topics were commonly reported under current ESRS 2023 but are not in your amended ESRS 2.0 DR list. You may choose to simplify your reporting.</p>
          <ul class="gap-can-drop-list">
            ${CAN_DROP_ITEMS.map(
              (it) =>
                `<li><strong>${escapeHtml(it.title)}</strong> — ${escapeHtml(it.detail)}</li>`
            ).join("")}
          </ul>
          <p class="gap-can-drop-note">This section is informational only.</p>
        </section>

        <div class="gap-actions">
          <button type="button" class="btn btn-primary" id="gap-save" ${state.saving ? "disabled" : ""}>${state.saving ? "Saving…" : "Save results"}</button>
          <button type="button" class="btn btn-secondary" id="gap-download-docx">Download report</button>
          <button type="button" class="btn btn-secondary" id="gap-new-run">New assessment</button>
        </div>`;

      document.getElementById("gap-save")?.addEventListener("click", () => saveResults());
      document.getElementById("gap-download-docx")?.addEventListener("click", () => downloadReport());
      document.getElementById("gap-new-run")?.addEventListener("click", () => {
        resetRun();
        render();
      });
      document.getElementById("gap-retry-failed")?.addEventListener("click", () =>
        retryFailedBatches()
      );
      attachGapUploadListeners();
      bindGapAskHandlers();
      return;
    }

    if (state.phase === "error") {
      root.innerHTML = `
        <div class="gap-step gap-panel">
          <p class="gap-error" role="alert">${escapeHtml(state.errorMessage)}</p>
          <button type="button" class="btn btn-secondary" id="gap-error-reset">Back</button>
        </div>`;
      document.getElementById("gap-error-reset")?.addEventListener("click", () => {
        state.phase = "idle";
        state.errorMessage = "";
        render();
      });
      return;
    }

    root.innerHTML = gapUploadSectionHtml({ showResultsLayout: false });
    attachGapUploadListeners();
  }

  async function retryFailedBatches() {
    if (!state.reportText || state.failedBatches.length === 0) {
      state.errorMessage = "Nothing to retry.";
      render();
      return;
    }
    const batches = [];
    for (let i = 0; i < state.drRows.length; i += BATCH_SIZE) {
      batches.push(state.drRows.slice(i, i + BATCH_SIZE));
    }

    state.phase = "evaluating";
    const newFailed = [];

    for (const fb of state.failedBatches) {
      const batch = batches[fb.index];
      if (!batch) continue;
      state.evalProgress = `Retrying batch ${fb.index + 1}…`;
      render();
      try {
        const results = await evaluateDrBatch({
          companyProfile: state.companyProfile || normalizeCompanyProfile({}),
          drBatch: batch.map((r) => ({
            ref: r.ref,
            title: r.title,
            standard: r.standard,
          })),
          reportText: state.reportText,
          chunkByRef: state.esrsChunkByRef ?? new Map(),
        });
        const resultByRef = new Map(results.map((r) => [r.ref, r]));
        for (const dr of batch) {
          const ev = resultByRef.get(dr.ref);
          const idx = state.evaluations.findIndex((e) => e.ref === dr.ref);
          if (ev && idx >= 0) {
            state.evaluations[idx] = {
              ref: dr.ref,
              title: dr.title,
              standard: dr.standard,
              status: ev.status,
              explanation: ev.explanation,
            };
          } else if (!ev) {
            newFailed.push({
              index: fb.index,
              refs: [dr.ref],
              message: "Model did not return an entry for this DR.",
            });
          }
        }
      } catch (e) {
        newFailed.push({
          index: fb.index,
          refs: fb.refs,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    state.failedBatches = newFailed;
    state.phase = "done";
    state.errorMessage = "";
    render();
  }

  async function refresh() {
    await checkDma();
    if (state.dmaCompleted) await loadDrContext();
    else {
      state.companyProfile = null;
      state.drRows = [];
    }
    const rpId = await resolveReportingPeriodId(supabase);
    let hydrated = false;
    if (state.dmaCompleted === true && rpId) {
      const row = await fetchSavedGapAssessment(supabase, rpId);
      const payload = row?.results;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        hydrated = hydrateFromSaved(/** @type {Record<string, unknown>} */ (payload));
      }
    }
    if (!hydrated) {
      resetRun();
    }
    render();
  }

  document
    .getElementById("reporting-period-select")
    ?.addEventListener("change", () => refresh());

  document
    .querySelector('.nav-btn[data-nav="gap-assessment"]')
    ?.addEventListener("click", () => {
      setTimeout(() => refresh(), 0);
    });

  refresh();
}
