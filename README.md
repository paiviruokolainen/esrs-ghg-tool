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

- GHG management
  - Records GHG emissions data across Scope 1, 2 and all 15 
    Scope 3 categories
  - Follows GHG Protocol and ESRS E1 structure
  - All values in tCO2e
  - Supports multiple reporting periods (years)
  - Emission factors: select from built-in library or enter 
    custom factors with source notes
  - Dashboard with totals by scope
  - PDF export of emissions report
  - Emission factor values are illustrative — 
  jurisdiction-specific factors needed for real reporting
  - Natural language emission factor search powered 
  by RAG (OpenAI embeddings + pgvector)

- CSRD reporting
 - Double Materiality Assessment (DMA) tool
  - Top-down approach per amended ESRS 1 AR 17
  - Covers ESRS 2 general disclosures and ESRS E1
  - AI-assisted materiality reasoning
  - Automatic DR list generation with omission tracking
  - Entity-specific disclosure documentation
  - Export to .docx for professional review
  - Based on amended ESRS 2.0 (draft standards)

- Gap Assessment
  - Upload existing sustainability report PDF
  - Evaluated against approved DMA DR list
  - Uses actual amended ESRS 2.0 requirement text
  - Results: Present / Partial / Missing per DR
  - Contextual AI Q&A on Missing and Partial DRs
  - Export to .docx
  - Based on amended ESRS 2.0 (draft standards)

- ESRS Document Pipeline
  - ESRS PDFs chunked by Disclosure Requirement
  - Embeddings stored in Supabase pgvector
  - Covers amended ESRS 2 and ESRS E1

---

## Standards alignment

- GHG Protocol Corporate Standard
- ESRS E1 (European Sustainability Reporting Standards)
- Emission factors sourced from IPCC 2006 Guidelines, 
  IPCC AR6, and GHG Protocol Technical Guidance
- ESRS 2.0

---

## Current status

**Test version — not for real reporting use.**

- UI complete and functional
- Supabase database connected
- User authentication working (email/password)
- Emissions data saved per user and reporting period
- Reporting periods managed in database

- Full CSRD platform: DMA + Gap Assessment complete
- Carbon accounting with RAG emission factor search
- All data persisted to Supabase per user and period

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

## Live demo

Deployed at: https://ghg-tool-xi.vercel.app/

To test:
1. Open the URL
2. Sign up with your email
3. Verify your email
4. Sign in and start entering data

Note: This is a test version. 
Not for real reporting use.

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