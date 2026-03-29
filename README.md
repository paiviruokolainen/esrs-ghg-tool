# GHG Emissions Data Management Tool

A test project exploring what companies can build themselves 
for GHG emissions data management, versus where commercial 
software vendors add value.

Built by a non-developer using AI-assisted coding (Cursor) 
as the primary development tool.

---

## Purpose

Most GHG emissions management tools are expensive, complex, 
and opaque. This project tests whether a functional, 
standards-aligned tool can be built from scratch by someone 
with no coding background — and what the real limitations are.

---

## What it does

- Records GHG emissions data across Scope 1, 2 and all 15 
  Scope 3 categories
- Follows GHG Protocol and ESRS E1 structure
- All values in tCO2e
- Supports multiple reporting periods (years)
- Emission factors: select from built-in library or enter 
  custom factors with source notes
- Dashboard with totals by scope
- PDF export of emissions report

---

## Standards alignment

- GHG Protocol Corporate Standard
- ESRS E1 (European Sustainability Reporting Standards)
- Emission factors sourced from IPCC 2006 Guidelines, 
  IPCC AR6, and GHG Protocol Technical Guidance

---

## Current status

**Test version — not for real reporting use.**

- UI complete and functional
- Emission factors served from Supabase database
- Emissions data still stored in localStorage pending auth
- Supabase database integration in progress
- User authentication not yet implemented
- Emission factor values are illustrative — 
  jurisdiction-specific factors needed for real reporting

---

## Tech stack

- Pure HTML, CSS, JavaScript (no frameworks)
- jsPDF for PDF export
- Supabase (planned — database and authentication)
- Hosted via GitHub

---

## Running locally

1. Clone the repository
```bash
git clone https://github.com/paiviruokolainen/ghg-tool.git
```
2. Open `index.html` in your browser
3. No build step or dependencies required

---

## Known limitations

- Data is stored in your browser only — clearing browser 
  data will erase all entries
- No user accounts yet — not suitable for multi-user use 
  until Supabase is connected
- Emission factors are illustrative defaults — 
  replace with jurisdiction-specific values for reporting
- No historical data migration — each version starts fresh

---

## Roadmap

- [ ] Supabase database integration
- [ ] User authentication and multi-user support
- [ ] Per-user private emission factors
- [ ] DESNZ 2024 emission factor dataset
- [ ] Year-on-year comparison view
- [ ] PDF report showing which EFs were used
- [ ] Vite build setup for proper web hosting

---

## Disclaimer

This tool is a learning and test project. 
It is not audited or validated for official 
GHG reporting purposes.