/**
 * Emission factor registry (kg CO2e per activity unit). Populated from Supabase `emission_factors`.
 */

/** @type {Array<{id: string, groupId: string, label: string, valueKgCo2ePerUnit: number, activityUnit: string, source: string, year: string}>} */
let EMISSION_FACTOR_LIBRARY = [];

let byId = new Map();
let byGroup = new Map();

let emissionFactorsLoading = true;

export function isEmissionFactorsLoading() {
  return emissionFactorsLoading;
}

function rebuildIndexes() {
  byId = new Map(EMISSION_FACTOR_LIBRARY.map((f) => [f.id, f]));
  byGroup = new Map();
  EMISSION_FACTOR_LIBRARY.forEach((f) => {
    if (!byGroup.has(f.groupId)) byGroup.set(f.groupId, []);
    byGroup.get(f.groupId).push(f);
  });
}

function getFactorsByGroup(groupId) {
  return byGroup.get(groupId) || [];
}

function getFactorById(id) {
  return byId.get(id) || null;
}

function getDefaultFactorIdForGroup(groupId) {
  const list = getFactorsByGroup(groupId);
  return list.length ? list[0].id : "";
}

/**
 * @param {"scope1"|"scope2"|"scope3"} scope
 * @param {string} key field key e.g. stationary, locationBased, cat1
 */
function getGroupId(scope, key) {
  if (scope === "scope1") return `scope1-${key}`;
  if (scope === "scope2") {
    if (key === "locationBased") return "scope2-lb";
    if (key === "marketBased") return "scope2-mb";
  }
  if (scope === "scope3") return `scope3-${key}`;
  return "";
}

function refreshWindowApi() {
  window.EmissionFactors = {
    get EMISSION_FACTOR_LIBRARY() {
      return EMISSION_FACTOR_LIBRARY;
    },
    getFactorsByGroup,
    getFactorById,
    getDefaultFactorIdForGroup,
    getGroupId,
  };
}

/**
 * Map a Supabase row to the internal factor shape.
 * Supports snake_case (PostgREST) or camelCase column names.
 */
function normalizeEmissionFactorRow(row) {
  const id = String(row.id ?? row.factor_id ?? "").trim();
  const groupId = String(row.group_id ?? row.groupId ?? "").trim();
  const label = String(row.label ?? "");
  const rawVal =
    row.value_kg_co2e_per_unit ?? row.valueKgCo2ePerUnit ?? row.value ?? null;
  const valueKgCo2ePerUnit =
    rawVal === null || rawVal === undefined || rawVal === ""
      ? NaN
      : Number(rawVal);
  const activityUnit = String(row.activity_unit ?? row.activityUnit ?? "");
  const source = String(row.source ?? "");
  const year = row.year != null && row.year !== "" ? String(row.year) : "";
  return {
    id,
    groupId,
    label,
    valueKgCo2ePerUnit,
    activityUnit,
    source,
    year,
  };
}

/**
 * Replace the in-memory library with normalized rows from Supabase.
 * Invalid rows (missing id or group_id, or non-numeric factor value) are skipped.
 */
export function applyEmissionFactorsFromRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map(normalizeEmissionFactorRow)
    .filter(
      (f) =>
        f.id &&
        f.groupId &&
        Number.isFinite(f.valueKgCo2ePerUnit)
    );
  EMISSION_FACTOR_LIBRARY = normalized;
  rebuildIndexes();
  refreshWindowApi();
  emissionFactorsLoading = false;
}

rebuildIndexes();
refreshWindowApi();
