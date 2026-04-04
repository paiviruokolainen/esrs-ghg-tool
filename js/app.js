/**
 * GHG Protocol–aligned emissions (tCO2e) with emission factor metadata.
 */

import {
  applyEmissionFactorsFromRows,
  isEmissionFactorsLoading,
} from "./emission-factors.js";
import { initAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { searchEmissionFactors } from "./rag-search.js";
import { initDma } from "./dma.js";
import { initGapAssessment } from "./gap-assessment.js";


const LEGACY_STORAGE_KEYS = ["ghg-tool-emissions-v1", "ghg-tool-emissions-v2"];
const STORAGE_GHG_DATA = "ghgData";

const SCOPE3_CATEGORIES = [
  { id: "cat1", name: "Purchased goods and services" },
  { id: "cat2", name: "Capital goods" },
  {
    id: "cat3",
    name: "Fuel- and energy-related activities (not included in Scope 1 or 2)",
  },
  { id: "cat4", name: "Upstream transportation and distribution" },
  { id: "cat5", name: "Waste generated in operations" },
  { id: "cat6", name: "Business travel" },
  { id: "cat7", name: "Employee commuting" },
  { id: "cat8", name: "Upstream leased assets" },
  { id: "cat9", name: "Downstream transportation and distribution" },
  { id: "cat10", name: "Processing of sold products" },
  { id: "cat11", name: "Use of sold products" },
  { id: "cat12", name: "End-of-life treatment of sold products" },
  { id: "cat13", name: "Downstream leased assets" },
  { id: "cat14", name: "Franchises" },
  { id: "cat15", name: "Investments" },
];

function getEF() {
  return window.EmissionFactors;
}

function parseNum(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyEntry(groupId) {
  const EF = getEF();
  return {
    activity: "",
    factorMode: "default",
    factorId: EF ? EF.getDefaultFactorIdForGroup(groupId) : "",
    customFactorKgPerUnit: "",
    customUnitLabel: "",
    customSourceNote: "",
    legacyTco2e: "",
  };
}

function normalizeEntry(raw, groupId) {
  const d = emptyEntry(groupId);
  if (raw == null) return d;
  if (typeof raw === "string" || typeof raw === "number") {
    const leg = parseNum(raw);
    return leg > 0
      ? { ...d, legacyTco2e: String(leg) }
      : d;
  }
  const merged = { ...d, ...raw };
  const EF = getEF();
  if (!merged.factorId && EF) {
    merged.factorId = EF.getDefaultFactorIdForGroup(groupId);
  }
  return merged;
}

function emptyState() {
  const EF = getEF();
  const s = {
    scope1: {
      stationary: emptyEntry("scope1-stationary"),
      mobile: emptyEntry("scope1-mobile"),
      fugitive: emptyEntry("scope1-fugitive"),
    },
    scope2: {
      locationBased: emptyEntry("scope2-lb"),
      marketBased: emptyEntry("scope2-mb"),
    },
    scope3: {},
  };
  SCOPE3_CATEGORIES.forEach((c) => {
    s.scope3[c.id] = emptyEntry(EF.getGroupId("scope3", c.id));
  });
  return s;
}

function mergeDeep(base, patch) {
  if (patch.scope1) {
    Object.keys(base.scope1).forEach((k) => {
      if (patch.scope1[k] != null) {
        base.scope1[k] = normalizeEntry(
          patch.scope1[k],
          getEF().getGroupId("scope1", k)
        );
      }
    });
  }
  if (patch.scope2) {
    ["locationBased", "marketBased"].forEach((k) => {
      const gid = k === "locationBased" ? "scope2-lb" : "scope2-mb";
      if (patch.scope2[k] != null) {
        base.scope2[k] = normalizeEntry(patch.scope2[k], gid);
      }
    });
  }
  if (patch.scope3) {
    SCOPE3_CATEGORIES.forEach((c) => {
      if (patch.scope3[c.id] != null) {
        base.scope3[c.id] = normalizeEntry(
          patch.scope3[c.id],
          getEF().getGroupId("scope3", c.id)
        );
      }
    });
  }
  return base;
}

function wipeLegacyAppStorageKeys() {
  LEGACY_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
  localStorage.removeItem(STORAGE_GHG_DATA);
}

function normalizePeriodPayload(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  return mergeDeep(base, raw);
}

function createEmptyGhgRoot() {
  return {
    selectedPeriod: "",
    periods: {},
    supabaseYears: [],
    periodIdByYear: {},
  };
}

/** Root document: selected reporting year + per-year emissions */
let ghgRoot = null;

function entryTco2e(entry) {
  const EF = getEF();
  const activity = parseNum(entry.activity);
  const legacy = parseNum(entry.legacyTco2e);

  if (activity > 0) {
    if (entry.factorMode === "custom") {
      const f = parseNum(entry.customFactorKgPerUnit);
      if (f > 0) return (activity * f) / 1000;
    } else if (entry.factorId) {
      const def = EF.getFactorById(entry.factorId);
      if (def) return (activity * def.valueKgCo2ePerUnit) / 1000;
    }
  }
  if (legacy > 0) return legacy;
  return 0;
}

function getFactorInUseText(entry) {
  const EF = getEF();
  const activity = parseNum(entry.activity);
  const legacy = parseNum(entry.legacyTco2e);

  if (legacy > 0 && activity <= 0) {
    return {
      kind: "legacy",
      badge: "Legacy",
      text: `Direct total from earlier version (${formatTco2e(legacy)} tCO2e). Enter activity and a factor to replace.`,
    };
  }

  if (entry.factorMode === "custom") {
    const f = parseNum(entry.customFactorKgPerUnit);
    const unit = entry.customUnitLabel || "unit of activity";
    const note = (entry.customSourceNote || "").trim() || "—";
    return {
      kind: "custom",
      badge: "Custom",
      text: `${f || "—"} kg CO2e per ${unit}. Source / note: ${note}`,
    };
  }

  const def = entry.factorId ? EF.getFactorById(entry.factorId) : null;
  if (!def) {
    return { kind: "default", badge: "Default", text: "Select a built-in factor." };
  }
  return {
    kind: "default",
    badge: "Default",
    text: `${def.valueKgCo2ePerUnit} kg CO2e per ${def.activityUnit} — ${def.source} (${def.year})`,
  };
}

function pdfFactorLines(entry) {
  const EF = getEF();
  const activity = parseNum(entry.activity);
  const legacy = parseNum(entry.legacyTco2e);

  if (legacy > 0 && activity <= 0) {
    return [
      "Type: legacy import (direct tCO2e)",
      `Total carried over: ${formatTco2e(legacy)} tCO2e`,
      "Emission factor: not recorded in v1 data",
    ];
  }

  if (entry.factorMode === "custom") {
    const lines = [
      "Type: custom factor",
      `Factor: ${entry.customFactorKgPerUnit || "—"} kg CO2e per ${
        entry.customUnitLabel || "unit"
      }`,
    ];
    const note = (entry.customSourceNote || "").trim();
    lines.push(note ? `Source / note: ${note}` : "Source / note: —");
    return lines;
  }

  const def = entry.factorId ? EF.getFactorById(entry.factorId) : null;
  if (!def) return ["Type: default (library)", "No factor selected"];
  return [
    "Type: default (built-in library)",
    `Factor: ${def.label}`,
    `Value: ${def.valueKgCo2ePerUnit} kg CO2e per ${def.activityUnit}`,
    `Reference: ${def.source} (${def.year})`,
  ];
}

function scope1Total(s1) {
  return (
    entryTco2e(s1.stationary) +
    entryTco2e(s1.mobile) +
    entryTco2e(s1.fugitive)
  );
}

function scope2Total(s2) {
  return (
    entryTco2e(s2.locationBased) +
    entryTco2e(s2.marketBased)
  );
}

function scope3Total(s3) {
  return SCOPE3_CATEGORIES.reduce(
    (sum, c) =>
      sum + entryTco2e(s3[c.id]),
    0
  );
}

function formatTco2e(n) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/** @type {ReturnType<typeof emptyState>} */
let appState = null;

function syncAppStateFromRoot() {
  if (!ghgRoot) return;
  const p = ghgRoot.selectedPeriod;
  if (!p) {
    appState = emptyState();
    return;
  }
  if (!ghgRoot.periods[p]) {
    ghgRoot.periods[p] = emptyState();
  }
  appState = ghgRoot.periods[p];
}

async function fetchReportingPeriodsFromSupabase() {
  if (!ghgRoot) return;
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    ghgRoot.supabaseYears = [];
    ghgRoot.selectedPeriod = "";
    ghgRoot.periodIdByYear = {};
    return;
  }
  const userId = userData.user.id;
  const { data: rows, error } = await supabase
    .from("reporting_periods")
    .select("id, year")
    .eq("user_id", userId)
    .order("year", { ascending: false });
  if (error) {
    console.error("reporting_periods:", error);
    ghgRoot.supabaseYears = [];
    ghgRoot.selectedPeriod = "";
    ghgRoot.periodIdByYear = {};
    return;
  }
  const years = (rows || []).map((r) => String(r.year));
  ghgRoot.supabaseYears = years;
  ghgRoot.periodIdByYear = {};
  (rows || []).forEach((r) => {
    ghgRoot.periodIdByYear[String(r.year)] = r.id;
  });
  for (const y of years) {
    if (!ghgRoot.periods[y]) ghgRoot.periods[y] = emptyState();
  }
  ghgRoot.selectedPeriod = years.length > 0 ? years[0] : "";
}

function categoryToGroupId(scope, category) {
  if (scope === "scope1") return `scope1-${category}`;
  if (scope === "scope2") {
    if (category === "locationBased") return "scope2-lb";
    if (category === "marketBased") return "scope2-mb";
  }
  if (scope === "scope3") return `scope3-${category}`;
  return "";
}

function rowToEntry(row, groupId) {
  const d = emptyEntry(groupId);
  const activityVal = row.activity_value ?? row.activityValue;
  d.activity =
    activityVal !== null && activityVal !== undefined && activityVal !== ""
      ? String(activityVal)
      : "";
  const factorId = row.emission_factor_id ?? row.emissionFactorId;
  const efVer = row.ef_version_used ?? row.efVersionUsed ?? "";
  const customVal = row.custom_ef_value ?? row.customEfValue;
  if (efVer === "custom") {
    d.factorMode = "custom";
    d.factorId = "";
    d.customFactorKgPerUnit =
      customVal != null && customVal !== "" ? String(customVal) : "";
    d.customUnitLabel = row.custom_ef_unit ?? row.customEfUnit ?? "";
    d.customSourceNote = row.custom_ef_source ?? row.customEfSource ?? "";
  } else {
    d.factorMode = "default";
    d.factorId = factorId != null && factorId !== "" ? String(factorId) : "";
  }
  const tco2e = row.tco2e_result ?? row.tco2eResult;
  if (parseNum(d.activity) <= 0 && parseNum(tco2e) > 0) {
    d.legacyTco2e = String(parseNum(tco2e));
  }
  return d;
}

function emissionsRowsToState(rows) {
  const state = emptyState();
  for (const row of rows) {
    const scope = row.scope;
    const cat = row.category;
    const gid = categoryToGroupId(scope, cat);
    const entry = rowToEntry(row, gid);
    if (scope === "scope1" && state.scope1[cat] !== undefined) {
      state.scope1[cat] = entry;
    } else if (scope === "scope2" && state.scope2[cat] !== undefined) {
      state.scope2[cat] = entry;
    } else if (scope === "scope3" && state.scope3[cat] !== undefined) {
      state.scope3[cat] = entry;
    }
  }
  return state;
}

async function fetchEmissionsForSelectedPeriod() {
  if (!ghgRoot) return;
  const year = ghgRoot.selectedPeriod;
  if (!year) {
    syncAppStateFromRoot();
    return;
  }
  const periodId = ghgRoot.periodIdByYear[year];
  if (!periodId) {
    ghgRoot.periods[year] = emptyState();
    syncAppStateFromRoot();
    return;
  }
  const { data: rows, error } = await supabase
    .from("emissions_data")
    .select("*")
    .eq("reporting_period_id", periodId);
  if (error) {
    console.error("emissions_data:", error);
    return;
  }
  ghgRoot.periods[year] = emissionsRowsToState(rows || []);
  syncAppStateFromRoot();
}

function buildEmissionRow(entry, scope, category, reportingPeriodId, userId) {
  const EF = getEF();
  const tco2e = entryTco2e(entry);
  let emission_factor_id = null;
  let ef_version_used = "";
  let custom_ef_value = null;
  let custom_ef_unit = null;
  let custom_ef_source = null;
  if (entry.factorMode === "custom") {
    ef_version_used = "custom";
    const v = parseNum(entry.customFactorKgPerUnit);
    custom_ef_value = Number.isFinite(v) ? v : null;
    custom_ef_unit = entry.customUnitLabel || null;
    custom_ef_source = entry.customSourceNote || null;
  } else {
    emission_factor_id = entry.factorId || null;
    const def = entry.factorId ? EF.getFactorById(entry.factorId) : null;
    ef_version_used = def ? String(def.year) : "";
  }
  return {
    reporting_period_id: reportingPeriodId,
    user_id: userId,
    scope,
    category,
    activity_value: parseNum(entry.activity),
    emission_factor_id,
    ef_version_used,
    custom_ef_value,
    custom_ef_unit,
    custom_ef_source,
    tco2e_result: tco2e,
  };
}

async function saveEmissionsScope(scopeKey) {
  const year = ghgRoot?.selectedPeriod;
  const periodId = year ? ghgRoot.periodIdByYear[year] : null;
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user || !periodId || !year) {
    showToast("Cannot save.");
    return;
  }
  const userId = userData.user.id;
  const st = ghgRoot.periods[year];
  if (!st) return;

  const { error: delErr } = await supabase
    .from("emissions_data")
    .delete()
    .eq("reporting_period_id", periodId)
    .eq("scope", scopeKey);
  if (delErr) {
    console.error("emissions_data delete:", delErr);
    return;
  }

  const rows = [];
  if (scopeKey === "scope1") {
    ["stationary", "mobile", "fugitive"].forEach((cat) => {
      rows.push(
        buildEmissionRow(st.scope1[cat], "scope1", cat, periodId, userId)
      );
    });
  } else if (scopeKey === "scope2") {
    ["locationBased", "marketBased"].forEach((cat) => {
      rows.push(
        buildEmissionRow(st.scope2[cat], "scope2", cat, periodId, userId)
      );
    });
  } else if (scopeKey === "scope3") {
    SCOPE3_CATEGORIES.forEach((c) => {
      rows.push(
        buildEmissionRow(st.scope3[c.id], "scope3", c.id, periodId, userId)
      );
    });
  }

  const { error: insErr } = await supabase.from("emissions_data").insert(rows);
  if (insErr) {
    console.error("emissions_data insert:", insErr);
    return;
  }
  showToast("Saved");
}

function initScopeSaveButtons() {
  document
    .getElementById("btn-save-scope1")
    ?.addEventListener("click", () => void saveEmissionsScope("scope1"));
  document
    .getElementById("btn-save-scope2")
    ?.addEventListener("click", () => void saveEmissionsScope("scope2"));
  document
    .getElementById("btn-save-scope3")
    ?.addEventListener("click", () => void saveEmissionsScope("scope3"));
}

function readEntryFromBlock(el) {
  const mode = el.querySelector(".factor-mode")?.value || "default";
  return {
    activity: el.querySelector(".entry-activity")?.value ?? "",
    factorMode: mode,
    factorId: el.querySelector(".factor-library-select")?.value ?? "",
    customFactorKgPerUnit: el.querySelector(".custom-factor")?.value ?? "",
    customUnitLabel: el.querySelector(".custom-unit-label")?.value ?? "",
    customSourceNote: el.querySelector(".custom-source-note")?.value ?? "",
    legacyTco2e: el.dataset.legacyTco2e || "",
  };
}

function refreshEntryBlock(el) {
  const entry = readEntryFromBlock(el);

  const defPanel = el.querySelector(".factor-default-panel");
  const custPanel = el.querySelector(".factor-custom-panel");
  if (entry.factorMode === "custom") {
    defPanel?.classList.add("hidden");
    custPanel?.classList.remove("hidden");
  } else {
    defPanel?.classList.remove("hidden");
    custPanel?.classList.add("hidden");
  }

  const sel = el.querySelector(".factor-library-select");
  const def = sel?.value ? getEF().getFactorById(sel.value) : null;
  const det = el.querySelector(".factor-details");
  if (det && def) {
    det.textContent = `${def.valueKgCo2ePerUnit} kg CO2e per ${def.activityUnit} · ${def.source} (${def.year})`;
  } else if (det) det.textContent = "";

  const unitEl = el.querySelector(".activity-unit");
  if (unitEl) {
    if (entry.factorMode === "custom") {
      unitEl.textContent = entry.customUnitLabel
        ? `(${entry.customUnitLabel})`
        : "(define unit in custom section)";
    } else if (def) {
      unitEl.textContent = `(${def.activityUnit})`;
    } else {
      unitEl.textContent = "";
    }
  }

  const t = entryTco2e(entry);
  const tv = el.querySelector(".computed-tco2e");
  if (tv) tv.textContent = formatTco2e(t);

  const fu = getFactorInUseText(entry);
  const fuLine = el.querySelector(".factor-in-use-line");
  if (fuLine) {
    fuLine.innerHTML = `<span class="factor-badge factor-badge--${escapeHtml(
      fu.kind
    )}">${escapeHtml(fu.badge)}</span> ${escapeHtml(fu.text)}`;
  }

  const leg = el.querySelector(".legacy-note");
  if (leg) {
    const show =
      parseNum(entry.legacyTco2e) > 0 && parseNum(entry.activity) <= 0;
    leg.classList.toggle("hidden", !show);
    if (show) {
      leg.textContent = `Legacy stored total: ${formatTco2e(
        parseNum(entry.legacyTco2e)
      )} tCO2e. Add activity and a factor to recalculate and clear this.`;
    }
  }
}

function bindEntryBlock(el) {
  const scope = el.getAttribute("data-scope");
  const key = el.getAttribute("data-key");

  const apply = () => {
    const e = readEntryFromBlock(el);
    if (parseNum(e.activity) > 0) e.legacyTco2e = "";
    el.dataset.legacyTco2e = e.legacyTco2e;
    if (scope === "scope1") appState.scope1[key] = e;
    else if (scope === "scope2") appState.scope2[key] = e;
    else if (scope === "scope3") appState.scope3[key] = e;
    refreshEntryBlock(el);
    refreshDashboard();
  };

  el.querySelectorAll(".entry-activity, .custom-factor, .custom-unit-label").forEach((inp) => {
    inp.addEventListener("input", apply);
  });
  el.querySelector(".custom-source-note")?.addEventListener("input", apply);
  el.querySelector(".factor-mode")?.addEventListener("change", () => {
    const e = readEntryFromBlock(el);
    if (scope === "scope1") appState.scope1[key] = e;
    else if (scope === "scope2") appState.scope2[key] = e;
    else appState.scope3[key] = e;
    refreshEntryBlock(el);
    refreshDashboard();
  });
  el.querySelector(".factor-library-select")?.addEventListener("change", apply);
  el.querySelector(".btn-find-factor")?.addEventListener("click", () => {
    openFactorSearchModal(el);
  });
}

function buildFactorSelect(groupId, selectedId) {
  if (isEmissionFactorsLoading()) {
    return `<option value="" disabled selected>Loading factors...</option>`;
  }
  const list = getEF().getFactorsByGroup(groupId);
  if (list.length === 0) {
    return `<option value="" disabled selected>No factors for this group</option>`;
  }
  return list
    .map(
      (f) =>
        `<option value="${escapeHtml(f.id)}" ${
          f.id === selectedId ? "selected" : ""
        }>${escapeHtml(f.label)}</option>`
    )
    .join("");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function sortedReportingYears() {
  if (!ghgRoot || !Array.isArray(ghgRoot.supabaseYears)) return [];
  return [...ghgRoot.supabaseYears].sort(
    (a, b) => Number(b) - Number(a)
  );
}

function refreshReportingPeriodSelect() {
  const sel = document.getElementById("reporting-period-select");
  if (!sel || !ghgRoot) return;
  const years = sortedReportingYears();
  sel.innerHTML = years
    .map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`)
    .join("");
  sel.value = ghgRoot.selectedPeriod;
  if (years.length && !years.includes(ghgRoot.selectedPeriod)) {
    ghgRoot.selectedPeriod = years[0];
    sel.value = ghgRoot.selectedPeriod;
    syncAppStateFromRoot();
  }
}

function setReportingPeriodNewFormVisible(show) {
  const wrap = document.getElementById("reporting-period-new-wrap");
  const input = document.getElementById("reporting-period-year-input");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
  if (show && input) {
    input.value = "";
    input.focus();
  }
}

function initReportingPeriodBar() {
  const sel = document.getElementById("reporting-period-select");
  const btnNew = document.getElementById("reporting-period-new");
  const input = document.getElementById("reporting-period-year-input");
  const btnConfirm = document.getElementById("reporting-period-confirm");
  const btnCancel = document.getElementById("reporting-period-cancel");
  const wrap = document.getElementById("reporting-period-new-wrap");

  refreshReportingPeriodSelect();

  sel?.addEventListener("change", () => {
    void (async () => {
      const next = sel.value;
      if (!next || next === ghgRoot.selectedPeriod) return;
      ghgRoot.selectedPeriod = next;
      await fetchEmissionsForSelectedPeriod();
      syncAppStateFromRoot();
      renderScope1Entries();
      renderScope2Entries();
      renderScope3Fields();
      refreshDashboard();
    })();
  });

  btnNew?.addEventListener("click", () => {
    setReportingPeriodNewFormVisible(wrap?.classList.contains("hidden"));
  });

  btnCancel?.addEventListener("click", () => setReportingPeriodNewFormVisible(false));

  async function confirmNewPeriod() {
    const raw = (input?.value || "").trim();
    const y = parseInt(raw, 10);
    if (!Number.isFinite(y) || y < 1990 || y > 2100) {
      showToast("Enter a valid year between 1990 and 2100.");
      return;
    }
    const key = String(y);
    if (ghgRoot.supabaseYears.includes(key)) {
      showToast("Reporting period already exists");
      return;
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return;
    const { data: inserted, error } = await supabase
      .from("reporting_periods")
      .insert({
        user_id: userData.user.id,
        year: y,
      })
      .select("id, year")
      .single();
    if (error) {
      if (
        error.code === "23505" ||
        String(error.message || "")
          .toLowerCase()
          .includes("duplicate") ||
        error.code === "409"
      ) {
        showToast("Reporting period already exists");
      } else {
        console.error("reporting_periods insert:", error);
      }
      return;
    }
    ghgRoot.periodIdByYear[key] = inserted.id;
    ghgRoot.supabaseYears = [...ghgRoot.supabaseYears, key].sort(
      (a, b) => Number(b) - Number(a)
    );
    if (!ghgRoot.periods[key]) ghgRoot.periods[key] = emptyState();
    ghgRoot.selectedPeriod = key;
    await fetchEmissionsForSelectedPeriod();
    syncAppStateFromRoot();
    refreshReportingPeriodSelect();
    setReportingPeriodNewFormVisible(false);
    renderScope1Entries();
    renderScope2Entries();
    renderScope3Fields();
    refreshDashboard();
  }

  btnConfirm?.addEventListener("click", () => void confirmNewPeriod());
  input?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void confirmNewPeriod();
    }
  });
}

function entryBlockHtml(scope, key, title) {
  const groupId = getEF().getGroupId(scope, key);
  const entry =
    scope === "scope1"
      ? appState.scope1[key]
      : scope === "scope2"
        ? appState.scope2[key]
        : appState.scope3[key];
  const selOptions = buildFactorSelect(groupId, entry.factorId);
  return `
    <div class="entry-block" data-scope="${scope}" data-key="${key}" data-legacy-tco2e="${escapeHtml(
      String(entry.legacyTco2e || "")
    )}">
      <h3 class="entry-heading">${escapeHtml(title)}</h3>
      <div class="field">
        <label>Activity <span class="field-hint">(amount for this line)</span></label>
        <div class="activity-row">
          <input type="number" class="entry-activity" min="0" step="any" placeholder="0" inputmode="decimal" value="${escapeHtml(
            entry.activity
          )}" />
          <span class="activity-unit"></span>
        </div>
      </div>
      <div class="field">
        <label>Emission factor source</label>
        <select class="factor-mode">
          <option value="default" ${entry.factorMode === "default" ? "selected" : ""}>Built-in library</option>
          <option value="custom" ${entry.factorMode === "custom" ? "selected" : ""}>Custom factor</option>
        </select>
      </div>
      <div class="factor-default-panel ${entry.factorMode === "custom" ? "hidden" : ""}">
        <div class="field">
          <label>Library factor</label>
          <div class="factor-picker-row">
            <select class="factor-library-select">${selOptions}</select>
            <button type="button" class="btn btn-secondary btn-compact btn-find-factor">Find a factor</button>
          </div>
        </div>
        <p class="factor-details"></p>
      </div>
      <div class="factor-custom-panel ${entry.factorMode === "default" ? "hidden" : ""}">
        <div class="field">
          <label>Custom factor <span class="field-hint">(kg CO2e per unit of activity)</span></label>
          <input type="number" class="custom-factor" min="0" step="any" placeholder="0" value="${escapeHtml(
            entry.customFactorKgPerUnit
          )}" />
        </div>
        <div class="field">
          <label>Activity unit label</label>
          <input type="text" class="custom-unit-label" placeholder="e.g. per MWh, per litre" value="${escapeHtml(
            entry.customUnitLabel
          )}" />
        </div>
        <div class="field">
          <label>Source note</label>
          <textarea class="custom-source-note" rows="2" placeholder="Citation, dataset, or internal reference">${escapeHtml(
            entry.customSourceNote
          )}</textarea>
        </div>
      </div>
      <div class="entry-summary">
        <p class="entry-emissions-line"><strong>Emissions:</strong> <span class="computed-tco2e">0</span> tCO2e</p>
        <p class="factor-in-use-line"></p>
        <p class="legacy-note hidden"></p>
      </div>
    </div>
  `;
}

function renderScope1Entries() {
  const root = document.getElementById("scope1-entries");
  if (!root) return;
  root.innerHTML = [
    ["stationary", "Stationary combustion"],
    ["mobile", "Mobile combustion"],
    ["fugitive", "Fugitive emissions"],
  ]
    .map(([k, t]) => entryBlockHtml("scope1", k, t))
    .join("");
  root.querySelectorAll(".entry-block").forEach((el) => {
    bindEntryBlock(el);
    refreshEntryBlock(el);
  });
}

function renderScope2Entries() {
  const root = document.getElementById("scope2-entries");
  if (!root) return;
  root.innerHTML = [
    ["locationBased", "Electricity — location-based"],
    ["marketBased", "Electricity — market-based"],
  ]
    .map(([k, t]) => entryBlockHtml("scope2", k, t))
    .join("");
  root.querySelectorAll(".entry-block").forEach((el) => {
    bindEntryBlock(el);
    refreshEntryBlock(el);
  });
}

function renderScope3Fields() {
  const container = document.getElementById("scope3-fields");
  if (!container) return;
  container.innerHTML = SCOPE3_CATEGORIES.map((c, i) => {
    const title = `${i + 1}. ${c.name}`;
    return entryBlockHtml("scope3", c.id, title);
  }).join("");
  container.querySelectorAll(".entry-block").forEach((el) => {
    bindEntryBlock(el);
    refreshEntryBlock(el);
  });
}

function renderFactorLibrary() {
  const root = document.getElementById("factor-library-root");
  if (!root) return;
  if (isEmissionFactorsLoading()) {
    root.innerHTML = `
    <div class="table-scroll">
      <table class="factor-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Factor</th>
            <th>kg CO2e / unit</th>
            <th>Activity unit</th>
            <th>Source</th>
            <th>Year</th>
          </tr>
        </thead>
        <tbody><tr><td colspan="6">Loading factors...</td></tr></tbody>
      </table>
    </div>
    <p class="panel-desc" style="margin-top:1rem;margin-bottom:0">Figures are illustrative defaults for tool demonstration; use jurisdiction-specific factors for statutory reporting.</p>
  `;
    return;
  }
  const lib = getEF().EMISSION_FACTOR_LIBRARY;
  const rows = lib
    .map(
      (f) => `
    <tr>
      <td>${escapeHtml(f.groupId)}</td>
      <td>${escapeHtml(f.label)}</td>
      <td class="num">${f.valueKgCo2ePerUnit}</td>
      <td>${escapeHtml(f.activityUnit)}</td>
      <td>${escapeHtml(f.source)}</td>
      <td>${escapeHtml(f.year)}</td>
    </tr>
  `
    )
    .join("");
  root.innerHTML = `
    <div class="table-scroll">
      <table class="factor-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Factor</th>
            <th>kg CO2e / unit</th>
            <th>Activity unit</th>
            <th>Source</th>
            <th>Year</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="panel-desc" style="margin-top:1rem;margin-bottom:0">Figures are illustrative defaults for tool demonstration; use jurisdiction-specific factors for statutory reporting.</p>
  `;
}

function refreshDashboard() {
  const t1 = scope1Total(appState.scope1);
  const t2 = scope2Total(appState.scope2);
  const t3 = scope3Total(appState.scope3);
  const total = t1 + t2 + t3;

  const setText = (id, text) => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };

  setText("dash-s1", formatTco2e(t1));
  setText("dash-s2", formatTco2e(t2));
  setText("dash-s3", formatTco2e(t3));
  setText("dash-total", formatTco2e(total));

  const max = Math.max(t1, t2, t3, 0.0001);
  const pct = (v) => Math.min(100, (v / max) * 100);

  const f1 = document.getElementById("bar-s1");
  const f2 = document.getElementById("bar-s2");
  const f3 = document.getElementById("bar-s3");
  if (f1) f1.style.width = `${pct(t1)}%`;
  if (f2) f2.style.width = `${pct(t2)}%`;
  if (f3) f3.style.width = `${pct(t3)}%`;

  setText("bar-label-s1", `${formatTco2e(t1)} tCO2e`);
  setText("bar-label-s2", `${formatTco2e(t2)} tCO2e`);
  setText("bar-label-s3", `${formatTco2e(t3)} tCO2e`);
}

function showNav(sectionId) {
  document.querySelectorAll("[data-section]").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `section-${sectionId}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const match = btn.getAttribute("data-nav") === sectionId;
    btn.setAttribute("aria-current", match ? "page" : "false");
  });
}

function initNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showNav(btn.getAttribute("data-nav"));
    });
  });
}

function showToast(message) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.add("visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("visible"), 2600);
}

let factorSearchModalState = {
  root: null,
  currentEntryBlock: null,
  /** @type {{ scope: string, key: string } | null} */
  entryScopeKey: null,
};

function resolveFactorSearchEntryBlock() {
  let entry = factorSearchModalState.currentEntryBlock;
  if (entry && entry.isConnected) return entry;
  const sk = factorSearchModalState.entryScopeKey;
  if (sk?.scope && sk?.key) {
    entry = document.querySelector(
      `.entry-block[data-scope="${sk.scope}"][data-key="${sk.key}"]`
    );
  }
  return entry || null;
}

/**
 * Ensures the library <select> has an <option> for factorId so .value can be set.
 * Search can return factors outside the row's group; those IDs are missing from the dropdown until added.
 */
function ensureSelectHasFactorOption(select, factorId, labelFallback) {
  if (!factorId) return;
  if (Array.from(select.options).some((o) => o.value === factorId)) return;
  const f = getEF().getFactorById(factorId);
  const label = f?.label ?? labelFallback ?? factorId;
  const opt = document.createElement("option");
  opt.value = factorId;
  opt.textContent = label;
  select.appendChild(opt);
}

function renderFactorSearchResults(results, container) {
  if (!container) return;
  if (!results || results.length === 0) {
    container.innerHTML =
      '<p class="factor-search-empty">No matching factors found.</p>';
    return;
  }
  container.innerHTML = results
    .map((r) => {
      const label = r.label ?? "";
      const value = r.value_kg_co2e_per_unit ?? r.valueKgCo2ePerUnit ?? "";
      const unit = r.activity_unit ?? r.activityUnit ?? "";
      const source = r.source ?? "";
      const year = r.year ?? "";
      return `
      <div class="factor-search-result">
        <div class="factor-search-result-main">
          <div class="factor-search-result-label">${escapeHtml(String(label))}</div>
          <div class="factor-search-result-meta">
            ${escapeHtml(String(value))} kg CO2e per ${escapeHtml(String(unit))}
          </div>
          <div class="factor-search-result-source">
            ${escapeHtml(String(source))}${year ? ` (${escapeHtml(String(year))})` : ""}
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-compact btn-use-found-factor" data-factor-id="${escapeHtml(
          String(r.id || "")
        )}" data-factor-label="${escapeHtml(String(label))}">
          Use this factor
        </button>
      </div>
    `;
    })
    .join("");
}

function closeFactorSearchModal() {
  if (!factorSearchModalState.root) return;
  factorSearchModalState.root.classList.add("hidden");
  factorSearchModalState.currentEntryBlock = null;
  factorSearchModalState.entryScopeKey = null;
}

function ensureFactorSearchModal() {
  if (factorSearchModalState.root) return factorSearchModalState.root;
  const wrap = document.createElement("div");
  wrap.id = "factor-search-modal";
  wrap.className = "factor-search-modal hidden";
  wrap.innerHTML = `
    <div class="factor-search-backdrop" data-action="close"></div>
    <div class="factor-search-panel" role="dialog" aria-modal="true" aria-label="Find a factor">
      <div class="factor-search-header">
        <h3>Find a factor</h3>
        <button type="button" class="btn btn-secondary btn-compact" data-action="close">Close</button>
      </div>
      <div class="field">
        <label for="factor-search-input">Describe what you're looking for...</label>
        <input
          id="factor-search-input"
          type="text"
          class="factor-search-input"
          placeholder="Describe what you're looking for..."
        />
      </div>
      <div class="factor-search-actions">
        <button type="button" class="btn btn-primary btn-compact" id="factor-search-submit">Search</button>
      </div>
      <div id="factor-search-results" class="factor-search-results"></div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.getAttribute("data-action") === "close") {
      closeFactorSearchModal();
      return;
    }
    const useBtn = target.closest(".btn-use-found-factor");
    if (useBtn) {
      const factorId = useBtn.getAttribute("data-factor-id") || "";
      const labelFallback = useBtn.getAttribute("data-factor-label") || "";
      const entry = resolveFactorSearchEntryBlock();
      if (!entry || !factorId) return;
      const select = entry.querySelector(".factor-library-select");
      const mode = entry.querySelector(".factor-mode");
      if (!(select instanceof HTMLSelectElement)) return;
      if (mode instanceof HTMLSelectElement) mode.value = "default";
      ensureSelectHasFactorOption(select, factorId, labelFallback);
      select.value = factorId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeFactorSearchModal();
    }
  });

  const searchInput = wrap.querySelector("#factor-search-input");
  const searchBtn = wrap.querySelector("#factor-search-submit");
  const resultsEl = wrap.querySelector("#factor-search-results");

  async function runSearch() {
    if (!(searchInput instanceof HTMLInputElement) || !resultsEl) return;
    const query = searchInput.value.trim();
    if (!query) {
      resultsEl.innerHTML =
        '<p class="factor-search-empty">Enter a query to search.</p>';
      return;
    }
    resultsEl.innerHTML = '<p class="factor-search-empty">Searching...</p>';
    try {
      const rows = await searchEmissionFactors(query, 3);
      renderFactorSearchResults(rows, resultsEl);
    } catch (err) {
      console.error("Factor search failed:", err);
      resultsEl.innerHTML =
        '<p class="factor-search-empty">Search failed. Check API key and RPC function.</p>';
    }
  }

  searchBtn?.addEventListener("click", () => {
    void runSearch();
  });
  searchInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void runSearch();
    }
  });

  factorSearchModalState.root = wrap;
  return wrap;
}

function openFactorSearchModal(entryBlock) {
  const root = ensureFactorSearchModal();
  factorSearchModalState.currentEntryBlock = entryBlock;
  factorSearchModalState.entryScopeKey = {
    scope: entryBlock.getAttribute("data-scope") || "",
    key: entryBlock.getAttribute("data-key") || "",
  };
  root.classList.remove("hidden");
  const input = root.querySelector("#factor-search-input");
  const resultsEl = root.querySelector("#factor-search-results");
  if (resultsEl) {
    resultsEl.innerHTML =
      '<p class="factor-search-empty">Run a search to see top matching factors.</p>';
  }
  if (input instanceof HTMLInputElement) {
    input.value = "";
    input.focus();
  }
}

function getJsPDFConstructor() {
  if (window.jspdf && typeof window.jspdf.jsPDF === "function") {
    return window.jspdf.jsPDF;
  }
  if (typeof window.jsPDF === "function") {
    return window.jsPDF;
  }
  return null;
}

function buildPdfReport() {
  const JsPDF = getJsPDFConstructor();
  if (!JsPDF) {
    showToast("PDF library failed to load. Ensure js/jspdf.umd.min.js is next to index.html.");
    return;
  }
  try {
    buildPdfReportInternal(JsPDF);
  } catch (err) {
    console.error(err);
    showToast(
      err && err.message ? `PDF error: ${err.message}` : "Could not create PDF."
    );
  }
}

function pdfAddLines(doc, lines, margin, startY, line, pageW) {
  let y = startY;
  lines.forEach((ln) => {
    const wrapped = doc.splitTextToSize(ln, pageW - margin * 2);
    wrapped.forEach((w) => {
      if (y > 280) {
        doc.addPage();
        y = margin;
      }
      doc.text(w, margin, y);
      y += line;
    });
  });
  return y;
}

function buildPdfReportInternal(JsPDF) {
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const margin = 18;
  let y = margin;
  const line = 5;
  const pageW = doc.internal.pageSize.getWidth();

  const t1 = scope1Total(appState.scope1);
  const t2 = scope2Total(appState.scope2);
  const t3 = scope3Total(appState.scope3);
  const grand = t1 + t2 + t3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 95);
  doc.text("GHG Emissions Summary Report", margin, y);
  y += line + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(92, 107, 127);
  y = pdfAddLines(
    doc,
    [
      "GHG Protocol scopes · Values in tCO2e · ESRS E1 (climate change — GHG emissions).",
      "Emission factors: each line shows default (library) or custom factor used.",
    ],
    margin,
    y,
    line,
    pageW
  );
  y += 2;

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageW - margin, y);
  y += line + 2;

  doc.setFontSize(11);
  doc.setTextColor(26, 35, 50);
  doc.setFont("helvetica", "bold");
  doc.text("Totals by scope", margin, y);
  y += line + 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const totalsRows = [
    ["Scope 1 — Direct emissions", formatTco2e(t1)],
    ["Scope 2 — Indirect emissions (energy)", formatTco2e(t2)],
    ["Scope 3 — Other indirect emissions", formatTco2e(t3)],
    ["Total", formatTco2e(grand)],
  ];
  totalsRows.forEach((row, i) => {
    doc.setFont("helvetica", i === 3 ? "bold" : "normal");
    doc.text(row[0], margin, y);
    doc.text(`${row[1]} tCO2e`, pageW - margin - 40, y);
    y += line;
  });
  y += 4;

  const scope1Labels = [
    ["stationary", "Stationary combustion"],
    ["mobile", "Mobile combustion"],
    ["fugitive", "Fugitive emissions"],
  ];
  doc.setFont("helvetica", "bold");
  doc.text("Scope 1 — Detail & emission factors", margin, y);
  y += line + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  scope1Labels.forEach(([k, label]) => {
    const ent = appState.scope1[k];
    const val = entryTco2e(ent);
    if (y > 265) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.text(`${label}: ${formatTco2e(val)} tCO2e`, margin, y);
    y += line;
    doc.setFont("helvetica", "normal");
    const fl = pdfFactorLines(ent);
    fl.forEach((ln) => {
      const wrapped = doc.splitTextToSize(`· ${ln}`, pageW - margin * 2);
      wrapped.forEach((w) => {
        if (y > 280) {
          doc.addPage();
          y = margin;
        }
        doc.text(w, margin + 2, y);
        y += line - 0.5;
      });
    });
    y += 2;
  });

  y += 2;
  if (y > 250) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Scope 2 — Detail & emission factors", margin, y);
  y += line + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  [
    ["locationBased", "Location-based electricity"],
    ["marketBased", "Market-based electricity"],
  ].forEach(([k, label]) => {
    const ent = appState.scope2[k];
    const val = entryTco2e(ent);
    doc.setFont("helvetica", "bold");
    doc.text(`${label}: ${formatTco2e(val)} tCO2e`, margin, y);
    y += line;
    doc.setFont("helvetica", "normal");
    pdfFactorLines(ent).forEach((ln) => {
      const wrapped = doc.splitTextToSize(`· ${ln}`, pageW - margin * 2);
      wrapped.forEach((w) => {
        if (y > 280) {
          doc.addPage();
          y = margin;
        }
        doc.text(w, margin + 2, y);
        y += line - 0.5;
      });
    });
    y += 2;
  });

  y += 2;
  if (y > 230) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Scope 3 — Categories, totals & emission factors", margin, y);
  y += line + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  SCOPE3_CATEGORIES.forEach((c, idx) => {
    const ent = appState.scope3[c.id];
    const val = entryTco2e(ent);
    const head = `${idx + 1}. ${c.name}: ${formatTco2e(val)} tCO2e`;
    const headLines = doc.splitTextToSize(head, pageW - margin * 2);
    headLines.forEach((hl) => {
      if (y > 278) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.text(hl, margin, y);
      y += line - 0.5;
    });
    doc.setFont("helvetica", "normal");
    pdfFactorLines(ent).forEach((ln) => {
      const wrapped = doc.splitTextToSize(`· ${ln}`, pageW - margin * 2 - 2);
      wrapped.forEach((w) => {
        if (y > 282) {
          doc.addPage();
          y = margin;
        }
        doc.text(w, margin + 2, y);
        y += line - 0.5;
      });
    });
    y += 1.5;
  });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.setFontSize(8);
  doc.setTextColor(150, 160, 175);
  doc.text(`Generated ${stamp}`, margin, doc.internal.pageSize.getHeight() - 12);

  doc.save(`ghg-emissions-report-${stamp}.pdf`);
  showToast("PDF report downloaded.");
}

function initPdfButton() {
  const btn = document.getElementById("btn-download-pdf");
  if (btn) btn.addEventListener("click", buildPdfReport);
}

async function bootstrapApp() {
  if (!window.EmissionFactors) {
    console.error("EmissionFactors module missing");
    return;
  }
  wipeLegacyAppStorageKeys();
  ghgRoot = createEmptyGhgRoot();
  await fetchReportingPeriodsFromSupabase();
  syncAppStateFromRoot();
  renderFactorLibrary();
  renderScope1Entries();
  renderScope2Entries();
  renderScope3Fields();
  initReportingPeriodBar();
  initNavigation();
  initPdfButton();
  initScopeSaveButtons();
  refreshDashboard();

  try {
    const { data, error } = await supabase.from("emission_factors").select("*");
    if (error) throw error;
    applyEmissionFactorsFromRows(data ?? []);
  } catch (err) {
    console.error("Supabase emission_factors:", err);
    applyEmissionFactorsFromRows([]);
  }

  await fetchEmissionsForSelectedPeriod();
  renderFactorLibrary();
  renderScope1Entries();
  renderScope2Entries();
  renderScope3Fields();
  refreshDashboard();

  initDma(supabase);
  initGapAssessment(supabase);
}

initAuth(bootstrapApp);
