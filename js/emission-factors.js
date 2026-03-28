/**
 * Built-in illustrative emission factors (kg CO2e per activity unit).
 * Values are rounded from IPCC 2006 Guidelines, IPCC AR6 (GWP100), and
 * GHG Protocol Technical Guidance — replace with jurisdiction-specific factors for reporting.
 */
(function (global) {
  /** @type {Array<{id: string, groupId: string, label: string, valueKgCo2ePerUnit: number, activityUnit: string, source: string, year: string}>} */
  const EMISSION_FACTOR_LIBRARY = [
    // Scope 1 — Stationary combustion
    {
      id: "s1-sta-ng-kwh",
      groupId: "scope1-stationary",
      label: "Natural gas — stationary combustion",
      valueKgCo2ePerUnit: 0.202,
      activityUnit: "kWh (thermal energy)",
      source: "IPCC 2006 Guidelines (Vol. 2, stationary combustion)",
      year: "2019",
    },
    {
      id: "s1-sta-diesel-l",
      groupId: "scope1-stationary",
      label: "Diesel — stationary combustion",
      valueKgCo2ePerUnit: 2.68,
      activityUnit: "litres",
      source: "IPCC 2006 / DEFRA-style fuel factors (illustrative)",
      year: "2023",
    },
    {
      id: "s1-sta-lpg-l",
      groupId: "scope1-stationary",
      label: "LPG — stationary combustion",
      valueKgCo2ePerUnit: 1.51,
      activityUnit: "litres",
      source: "IPCC 2006 Guidelines",
      year: "2019",
    },
    {
      id: "s1-sta-coal-t",
      groupId: "scope1-stationary",
      label: "Hard coal — stationary combustion",
      valueKgCo2ePerUnit: 2410,
      activityUnit: "tonnes",
      source: "IPCC 2006 (default emission factor, illustrative)",
      year: "2019",
    },
    // Scope 1 — Mobile combustion
    {
      id: "s1-mob-diesel-l",
      groupId: "scope1-mobile",
      label: "Diesel — on-road / mobile",
      valueKgCo2ePerUnit: 2.68,
      activityUnit: "litres",
      source: "IPCC 2006 Guidelines (mobile combustion)",
      year: "2019",
    },
    {
      id: "s1-mob-petrol-l",
      groupId: "scope1-mobile",
      label: "Petrol — on-road / mobile",
      valueKgCo2ePerUnit: 2.31,
      activityUnit: "litres",
      source: "IPCC 2006 Guidelines",
      year: "2019",
    },
    {
      id: "s1-mob-jet-l",
      groupId: "scope1-mobile",
      label: "Jet kerosene — aviation (mobile)",
      valueKgCo2ePerUnit: 2.54,
      activityUnit: "litres",
      source: "IPCC 2006 / GHG Protocol (illustrative)",
      year: "2019",
    },
    // Scope 1 — Fugitive
    {
      id: "s1-fug-r134a-kg",
      groupId: "scope1-fugitive",
      label: "R-134a refrigerant leakage",
      valueKgCo2ePerUnit: 1530,
      activityUnit: "kg (refrigerant leaked)",
      source: "IPCC AR6 (GWP100) / IPCC 2006 (fugitive)",
      year: "2021",
    },
    {
      id: "s1-fug-r410a-kg",
      groupId: "scope1-fugitive",
      label: "R-410A refrigerant leakage",
      valueKgCo2ePerUnit: 2256,
      activityUnit: "kg (refrigerant leaked)",
      source: "IPCC AR6 (GWP100)",
      year: "2021",
    },
    {
      id: "s1-fug-ch4-kg",
      groupId: "scope1-fugitive",
      label: "Methane (CH4) — fugitive release",
      valueKgCo2ePerUnit: 29.8,
      activityUnit: "kg CH4",
      source: "IPCC AR6 (GWP100 for CH4)",
      year: "2021",
    },
    // Scope 2 — Electricity
    {
      id: "s2-lb-eu-kwh",
      groupId: "scope2-lb",
      label: "Grid electricity — EU average (location-based)",
      valueKgCo2ePerUnit: 0.35,
      activityUnit: "kWh purchased",
      source: "IEA / eGRID-style grid average (illustrative EU)",
      year: "2022",
    },
    {
      id: "s2-lb-us-kwh",
      groupId: "scope2-lb",
      label: "Grid electricity — US average (location-based)",
      valueKgCo2ePerUnit: 0.39,
      activityUnit: "kWh purchased",
      source: "GHG Protocol Scope 2 Guidance (illustrative grid)",
      year: "2023",
    },
    {
      id: "s2-lb-ren-kwh",
      groupId: "scope2-lb",
      label: "National renewable mix — location-based (illustrative low grid)",
      valueKgCo2ePerUnit: 0.12,
      activityUnit: "kWh purchased",
      source: "GHG Protocol Technical Guidance (illustrative)",
      year: "2023",
    },
    {
      id: "s2-mb-ppa-kwh",
      groupId: "scope2-mb",
      label: "Renewable PPA / EAC — market-based residual mix (illustrative)",
      valueKgCo2ePerUnit: 0.02,
      activityUnit: "kWh (contracted renewable)",
      source: "GHG Protocol Scope 2 Guidance (market-based)",
      year: "2023",
    },
    {
      id: "s2-mb-grid-kwh",
      groupId: "scope2-mb",
      label: "Supplier-specific residual / grid mix — market-based",
      valueKgCo2ePerUnit: 0.28,
      activityUnit: "kWh purchased",
      source: "GHG Protocol Scope 2 Guidance (illustrative)",
      year: "2023",
    },
  ];

  /** Scope 3: one illustrative factor per category (replace in real inventories). */
  const S3_BASE = [
    {
      id: "s3-c1-spend",
      label: "Purchased goods & services — spend-based (illustrative)",
      valueKgCo2ePerUnit: 0.45,
      activityUnit: "1000 EUR spend (activity = number of 1000s)",
      source: "GHG Protocol Scope 3 Calculation Guidance (spend-based, illustrative)",
      year: "2023",
    },
    {
      id: "s3-c2-capex",
      label: "Capital goods — spend-based (illustrative)",
      valueKgCo2ePerUnit: 0.52,
      activityUnit: "1000 EUR capex (activity = number of 1000s)",
      source: "GHG Protocol Scope 3 (capital goods, illustrative)",
      year: "2023",
    },
    {
      id: "s3-c3-wtt",
      label: "Fuel & energy-related (upstream) — WTT (illustrative)",
      valueKgCo2ePerUnit: 0.08,
      activityUnit: "kWh of Scope 2 electricity",
      source: "GHG Protocol Scope 3 Cat.3 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c4-tkm",
      label: "Upstream transport — road freight",
      valueKgCo2ePerUnit: 0.062,
      activityUnit: "tonne-km",
      source: "GHG Protocol Scope 3 Transport (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c5-waste-t",
      label: "Waste — landfill / treatment (generic)",
      valueKgCo2ePerUnit: 450,
      activityUnit: "tonnes waste",
      source: "IPCC 2006 Waste (illustrative mixed waste)",
      year: "2019",
    },
    {
      id: "s3-c6-air-km",
      label: "Business travel — short-haul air (illustrative)",
      valueKgCo2ePerUnit: 0.15,
      activityUnit: "passenger-km",
      source: "GHG Protocol Scope 3 Cat.6 (DEFRA-style, illustrative)",
      year: "2023",
    },
    {
      id: "s3-c7-commute-km",
      label: "Employee commuting — car average",
      valueKgCo2ePerUnit: 0.17,
      activityUnit: "vehicle-km",
      source: "GHG Protocol Scope 3 Cat.7 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c8-lease-m2",
      label: "Upstream leased assets — office energy (illustrative)",
      valueKgCo2ePerUnit: 0.09,
      activityUnit: "m²·year",
      source: "GHG Protocol Scope 3 Cat.8 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c9-down-tkm",
      label: "Downstream transport — road freight",
      valueKgCo2ePerUnit: 0.062,
      activityUnit: "tonne-km",
      source: "GHG Protocol Scope 3 Cat.9 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c10-proc-t",
      label: "Processing of sold products — mass allocation (illustrative)",
      valueKgCo2ePerUnit: 1.2,
      activityUnit: "tonnes processed",
      source: "GHG Protocol Scope 3 Cat.10 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c11-use-kwh",
      label: "Use of sold products — electricity in use phase",
      valueKgCo2ePerUnit: 0.35,
      activityUnit: "kWh (lifetime use, illustrative)",
      source: "GHG Protocol Scope 3 Cat.11 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c12-eol-t",
      label: "End-of-life treatment — generic product",
      valueKgCo2ePerUnit: 0.55,
      activityUnit: "tonnes EoL mass",
      source: "GHG Protocol Scope 3 Cat.12 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c13-dlease-m2",
      label: "Downstream leased assets — energy (illustrative)",
      valueKgCo2ePerUnit: 0.11,
      activityUnit: "m²·year",
      source: "GHG Protocol Scope 3 Cat.13 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c14-franchise-m2",
      label: "Franchises — floor area energy (illustrative)",
      valueKgCo2ePerUnit: 0.1,
      activityUnit: "m²·year",
      source: "GHG Protocol Scope 3 Cat.14 (illustrative)",
      year: "2023",
    },
    {
      id: "s3-c15-inv-k",
      label: "Investments — financed emissions intensity (illustrative)",
      valueKgCo2ePerUnit: 120,
      activityUnit: "1000 EUR invested (activity = number of 1000s)",
      source: "PCAF / GHG Protocol Scope 3 Cat.15 (illustrative)",
      year: "2023",
    },
  ];

  for (let i = 0; i < S3_BASE.length; i++) {
    const b = S3_BASE[i];
    EMISSION_FACTOR_LIBRARY.push({
      id: b.id,
      groupId: `scope3-cat${i + 1}`,
      label: b.label,
      valueKgCo2ePerUnit: b.valueKgCo2ePerUnit,
      activityUnit: b.activityUnit,
      source: b.source,
      year: b.year,
    });
  }

  const byId = new Map(EMISSION_FACTOR_LIBRARY.map((f) => [f.id, f]));
  const byGroup = new Map();

  EMISSION_FACTOR_LIBRARY.forEach((f) => {
    if (!byGroup.has(f.groupId)) byGroup.set(f.groupId, []);
    byGroup.get(f.groupId).push(f);
  });

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

  global.EmissionFactors = {
    EMISSION_FACTOR_LIBRARY,
    getFactorsByGroup,
    getFactorById,
    getDefaultFactorIdForGroup,
    getGroupId,
  };
})(typeof window !== "undefined" ? window : this);
