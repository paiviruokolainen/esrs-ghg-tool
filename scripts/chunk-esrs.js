#!/usr/bin/env node
/**
 * ESRS PDF → chunks by Disclosure Requirement → OpenAI embeddings → Supabase upsert.
 *
 * Usage:
 *   node scripts/chunk-esrs.js --file ./esrs-e1.pdf --standard "ESRS E1" --version "amended-2025"
 *
 * Environment (.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 *
 * Supabase table (example DDL — run in SQL editor; requires pgvector):
 *
 *   create extension if not exists vector;
 *   create table if not exists public.esrs_chunks (
 *     id uuid primary key default gen_random_uuid(),
 *     standard text not null,
 *     version text not null,
 *     disclosure_requirement text not null,
 *     title text not null default '',
 *     content text not null default '',
 *     embedding vector(1536),
 *     updated_at timestamptz not null default now(),
 *     constraint esrs_chunks_standard_version_dr_uidx unique (standard, version, disclosure_requirement)
 *   );
 *   create index if not exists esrs_chunks_embedding_idx on public.esrs_chunks using ivfflat (embedding vector_cosine_ops);
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";

const INTRO_REF = "__intro__";

/** @returns {{ file: string | null, standard: string | null, version: string | null }} */
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { file: null, standard: null, version: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file" && args[i + 1]) {
      out.file = args[++i];
      continue;
    }
    if (a === "--standard" && args[i + 1]) {
      out.standard = args[++i];
      continue;
    }
    if (a === "--version" && args[i + 1]) {
      out.version = args[++i];
      continue;
    }
  }
  return out;
}

/** Standard DR: "Disclosure Requirement [REF] – [Title]" (REF before title). En/em dash only. Not "General Disclosure…". */
const RE_STANDARD_DR =
  /(?<!General )Disclosure [Rr]equirement\s+(.+?)\s*[\u2013\u2014]\s*(.*)/g;

/** ESRS 2 GDR: "General Disclosure Requirement for … – GDR-X" (ref at end of line). */
const RE_GDR =
  /(General [Dd]isclosure [Rr]equirement for .+?)\s*[\u2013\u2014]\s*(GDR-[PAMT])/g;

/**
 * Split PDF text into an intro chunk (before first DR) and one chunk per Disclosure Requirement.
 * Standard DRs: "Disclosure Requirement [REF] – [Title]" (en/em dash; REF can include BP-1, E1-11).
 * GDR lines: "General Disclosure Requirement for policies – GDR-P" (title is full "General … for …", ref GDR-P).
 * @param {string} text
 * @returns {{ disclosure_requirement: string, title: string, content: string }[]}
 */
function splitIntoChunks(text) {
  const normalized = text.replace(/\r\n/g, "\n");

  /** @type {{ index: number, end: number, ref: string, title: string }[]} */
  const boundaries = [];

  for (const m of normalized.matchAll(RE_STANDARD_DR)) {
    const idx = m.index ?? 0;
    boundaries.push({
      index: idx,
      end: idx + m[0].length,
      ref: m[1].trim(),
      title: (m[2] ?? "").trim(),
    });
  }

  for (const m of normalized.matchAll(RE_GDR)) {
    const idx = m.index ?? 0;
    boundaries.push({
      index: idx,
      end: idx + m[0].length,
      ref: (m[2] ?? "").trim(),
      title: m[1].trim(),
    });
  }

  boundaries.sort((a, b) => a.index - b.index);

  if (boundaries.length === 0) {
    const c = normalized.trim();
    if (!c) return [];
    return [
      {
        disclosure_requirement: INTRO_REF,
        title: "Introduction",
        content: c,
      },
    ];
  }

  /** @type {{ disclosure_requirement: string, title: string, content: string }[]} */
  const chunks = [];

  const firstIdx = boundaries[0].index;
  const intro = normalized.slice(0, firstIdx).trim();
  if (intro) {
    chunks.push({
      disclosure_requirement: INTRO_REF,
      title: "Introduction",
      content: intro,
    });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const nextStart =
      i + 1 < boundaries.length ? boundaries[i + 1].index : normalized.length;
    const content = normalized.slice(b.end, nextStart).trim();
    chunks.push({
      disclosure_requirement: b.ref,
      title: b.title,
      content,
    });
  }

  return chunks;
}

/**
 * @param {string} standard
 * @param {string} version
 * @param {string} ref
 * @param {string} title
 * @param {string} content
 */
function buildEmbeddingInput(standard, version, ref, title, content) {
  const snippet = content.slice(0, 2000);
  return [standard, version, ref, title, snippet].filter(Boolean).join("\n");
}

async function main() {
  const { file, standard, version } = parseArgs();

  if (!file || !standard || !version) {
    console.error(
      "Usage: node scripts/chunk-esrs.js --file <path.pdf> --standard <name> --version <label>"
    );
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!url || !serviceKey || !openaiKey) {
    console.error(
      "Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and/or OPENAI_API_KEY"
    );
    process.exit(1);
  }

  const absPath = resolve(process.cwd(), file);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const pdfBuffer = await readFile(absPath);
  const parser = new PDFParse({ data: pdfBuffer });
  let fullText = "";
  try {
    const result = await parser.getText();
    fullText = result.text ?? "";
  } finally {
    await parser.destroy();
  }

  const chunks = splitIntoChunks(fullText);
  if (chunks.length === 0) {
    console.error("No text extracted from PDF; nothing to upload.");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const supabase = createClient(url, serviceKey);

  const total = chunks.length;
  for (let n = 0; n < chunks.length; n++) {
    const chunk = chunks[n];
    const i = n + 1;
    console.log(
      `Processing chunk ${i} of ${total}: ${chunk.disclosure_requirement}`
    );

    const input = buildEmbeddingInput(
      standard,
      version,
      chunk.disclosure_requirement,
      chunk.title,
      chunk.content
    );

    const embRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input,
    });

    const embedding = embRes.data[0]?.embedding;
    if (!embedding) {
      throw new Error(`No embedding returned for ${chunk.disclosure_requirement}`);
    }

    const { error } = await supabase.from("esrs_chunks").upsert(
      {
        standard,
        version,
        disclosure_requirement: chunk.disclosure_requirement,
        title: chunk.title,
        content: chunk.content,
        embedding,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "standard,version,disclosure_requirement" }
    );

    if (error) {
      console.error("Supabase upsert error:", error.message);
      process.exit(1);
    }
  }

  console.log(`Done. Upserted ${total} chunk(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
