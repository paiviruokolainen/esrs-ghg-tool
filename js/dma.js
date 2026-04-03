/**
 * Double Materiality Assessment (DMA) — top-down per amended ESRS 1 AR 17.
 * ESRS 2 general disclosures + ESRS E1 climate (draft ESRS 2.0 scope).
 */

import OpenAI from "openai";

/** @typedef {{ ref: string, title: string, standard: string, mandatory: boolean, id?: string }} DrRow */

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
        d.E1 = {
          ...d.E1,
          ...raw.E1,
          subtopics: {
            mitigation: raw.E1?.subtopics?.mitigation ?? null,
            adaptation: raw.E1?.subtopics?.adaptation ?? null,
            energy: raw.E1?.subtopics?.energy ?? null,
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
  if (level !== "material" && level !== "unsure") return [];

  const sub = e1.subtopics || {};
  const expanded = !!e1.subExpanded;
  const subKeys = ["mitigation", "adaptation", "energy"];
  const hasGranular =
    expanded &&
    subKeys.some((k) => sub[k] === "material" || sub[k] === "unsure" || sub[k] === "not_material");

  const includeSub = (k) => sub[k] === "material" || sub[k] === "unsure";

  if (!hasGranular) {
    return Object.keys(E1_DR_CATALOG).map((ref) => ({
      ref,
      title: E1_DR_CATALOG[ref].title,
      standard: "ESRS E1",
      mandatory: E1_DR_CATALOG[ref].mandatory,
    }));
  }

  const refs = new Set();
  if (includeSub("mitigation")) {
    ["E1-1", "E1-4", "E1-5", "E1-6", "E1-8"].forEach((r) => refs.add(r));
  }
  if (includeSub("adaptation")) {
    ["E1-2", "E1-3", "E1-11"].forEach((r) => refs.add(r));
  }
  if (includeSub("energy")) {
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
  let entitySpecificDisclosures = "";
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
    entitySpecificDisclosures = "";
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
      entitySpecificDisclosures = data.entity_specific_disclosures || "";
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

    const base = {
      user_id: userData.user.id,
      reporting_period_id: reportingPeriodId,
      company_profile: { ...companyProfile, ...patch.company_profile },
      topic_assessments: patch.topic_assessments ?? topicAssessments,
      dr_list: patch.dr_list ?? drList,
      entity_specific_disclosures:
        patch.entity_specific_disclosures ?? entitySpecificDisclosures,
      status: patch.status ?? status,
    };

    companyProfile = normalizeCompanyProfile(base.company_profile);
    topicAssessments = normalizeTopicAssessments(base.topic_assessments);
    drList = base.dr_list;
    entitySpecificDisclosures = base.entity_specific_disclosures;
    status = base.status;

    if (assessmentId) {
      const { error } = await supabase
        .from("dma_assessments")
        .update({
          company_profile: companyProfile,
          topic_assessments: topicAssessments,
          dr_list: drList,
          entity_specific_disclosures: entitySpecificDisclosures,
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
          entity_specific_disclosures: entitySpecificDisclosures,
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

  function materialityRadios(name, value, disabled) {
    const opts = [
      { v: "material", l: "Material" },
      { v: "not_material", l: "Not material" },
      { v: "unsure", l: "Unsure" },
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

  function materialityRow(name, value, disabled, compact) {
    const rowClass = compact ? "dma-mat-row dma-mat-row--compact" : "dma-mat-row";
    return `
      <div class="dma-mat-row-wrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem 0.75rem">
        <div class="${rowClass}">
          ${materialityRadios(name, value, disabled)}
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
        ${materialityRow("e1-level", e1.level, false, false)}
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
              ${materialityRow(`e1-sub-${st.key}`, v, false, true)}
            </div>`;
          }).join("")}
        </details>
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
          <button type="button" class="btn btn-primary" id="dma-s2-next">Next</button>
        </div>
      </div>
    `;
  }

  function renderStep3() {
    const e1 = topicAssessments.E1 || {};
    const lvl = e1.level;
    let body = "";

    if (lvl === "material" || lvl === "unsure") {
      body = `
        <div class="field">
          <label>Climate change (E1) — materiality: ${escapeHtml(lvl === "material" ? "Material" : "Unsure")}</label>
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

  function renderStep4() {
    const rows = drList.length ? drList : buildApplicableDrList(topicAssessments);
    const withIds = withRowIds(rows);
    const tableRows = withIds
      .map(
        (r) => `
      <tr data-dr-id="${escapeHtml(r.id || "")}">
        <td><code>${escapeHtml(r.ref)}</code></td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.standard)}</td>
        <td>${r.mandatory ? "Yes" : "No"}</td>
        <td><button type="button" class="btn btn-secondary btn-compact dma-remove-dr" data-id="${escapeHtml(r.id || "")}">Remove</button></td>
      </tr>
    `
      )
      .join("");

    return `
      <div class="dma-step">
        <h3 class="dma-step-title">Step 4 — Applicable disclosure requirements</h3>
        <p class="dma-step-intro">ESRS 2 DRs apply together with E1 DRs derived from your E1 screening. You can adjust the list manually.</p>
        <div class="dma-table-wrap">
          <table class="dma-table">
            <thead>
              <tr>
                <th>DR reference</th>
                <th>Title</th>
                <th>Standard</th>
                <th>Mandatory</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${tableRows || '<tr><td colspan="5">No rows</td></tr>'}</tbody>
          </table>
        </div>
        <div class="dma-add-dr">
          <input type="text" id="dma-add-ref" class="dma-input dma-input--sm" placeholder="DR ref" />
          <input type="text" id="dma-add-title" class="dma-input dma-input--flex" placeholder="Title" />
          <input type="text" id="dma-add-std" class="dma-input dma-input--sm" placeholder="Standard" value="ESRS" />
          <button type="button" class="btn btn-secondary btn-compact" id="dma-add-dr-btn">Add DR</button>
        </div>
        <button type="button" class="btn btn-secondary btn-compact" id="dma-regen">Regenerate from topic screening</button>
        <div class="field" style="margin-top:1rem">
          <label for="dma-entity-specific">Entity-specific disclosures — describe any material sustainability topics not covered by the DRs listed above.</label>
          <textarea id="dma-entity-specific" class="dma-textarea" rows="4">${escapeHtml(entitySpecificDisclosures)}</textarea>
        </div>
        <div class="dma-actions">
          <button type="button" class="btn btn-secondary" id="dma-s4-back">Back</button>
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
        setStep(3);
        await persistPartial({ topic_assessments: topicAssessments, company_profile: companyProfile });
        render();
      });

      function updateE1NotMaterialWarning() {
        const w = document.getElementById("dma-e1-notmat-warning");
        if (!w) return;
        const el = document.querySelector('input[name="e1-level"]:checked');
        const show = el?.value === "not_material";
        w.classList.toggle("hidden", !show);
      }

      document.querySelectorAll('input[name="e1-level"]').forEach((inp) => {
        inp.addEventListener("change", () => {
          const c = document.querySelector('input[name="e1-level"]:checked');
          topicAssessments.E1.level = c ? c.value : null;
          updateE1NotMaterialWarning();
        });
      });
      updateE1NotMaterialWarning();

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
            updateE1NotMaterialWarning();
          } else if (name.startsWith("e1-sub-")) {
            const key = name.slice("e1-sub-".length);
            if (topicAssessments.E1.subtopics) {
              topicAssessments.E1.subtopics[key] = null;
            }
          }
        });
      });

      document.querySelector(".dma-details")?.addEventListener("toggle", () => {
        const d = document.querySelector(".dma-details");
        if (topicAssessments.E1) topicAssessments.E1.subExpanded = !!d?.open;
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
            "Material or unsure",
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
        entitySpecificDisclosures = document.getElementById("dma-entity-specific")?.value || "";
        setStep(3);
        await persistPartial({
          dr_list: drList,
          entity_specific_disclosures: entitySpecificDisclosures,
          company_profile: companyProfile,
        });
        render();
      });
      document.getElementById("dma-s4-save")?.addEventListener("click", async () => {
        entitySpecificDisclosures = document.getElementById("dma-entity-specific")?.value || "";
        status = "completed";
        const ok = await persistPartial({
          dr_list: drList,
          entity_specific_disclosures: entitySpecificDisclosures,
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
        drList = withRowIds(buildApplicableDrList(topicAssessments));
        await persistPartial({ dr_list: drList });
        render();
      });
      document.getElementById("dma-add-dr-btn")?.addEventListener("click", async () => {
        const ref = document.getElementById("dma-add-ref")?.value?.trim() || "";
        const title = document.getElementById("dma-add-title")?.value?.trim() || "";
        const std = document.getElementById("dma-add-std")?.value?.trim() || "ESRS";
        if (!ref || !title) {
          showDmaInlineMessage("Add DR reference and title.", "error");
          return;
        }
        drList = [
          ...drList,
          {
            id: `custom-${Date.now()}`,
            ref,
            title,
            standard: std,
            mandatory: false,
          },
        ];
        await persistPartial({ dr_list: drList });
        render();
      });
      root.querySelectorAll(".dma-remove-dr").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id") || "";
          drList = drList.filter((r) => (r.id || "") !== id);
          await persistPartial({ dr_list: drList });
          render();
        });
      });
    }
  }

  const sel = document.getElementById("reporting-period-select");
  sel?.addEventListener("change", () => void loadAssessment());

  void loadAssessment();
}
