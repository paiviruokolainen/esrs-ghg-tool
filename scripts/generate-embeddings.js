import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 500;
const EMBEDDING_COLUMN = process.env.EMBEDDING_COLUMN || "embedding";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function validateEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function buildEmbeddingText(factor) {
  const label = String(factor.label || "").trim();
  const activityUnit = String(factor.activity_unit || "").trim();
  const source = String(factor.source || "").trim();
  return `${label}. Activity unit: ${activityUnit}. Source: ${source}`;
}

async function fetchAllFactors(supabase) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("emission_factors")
      .select("id, label, activity_unit, source")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    console.log(`Fetched ${rows.length} emission factors so far...`);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  return rows;
}

async function main() {
  validateEnv();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  console.log("Loading emission_factors from Supabase...");
  const factors = await fetchAllFactors(supabase);
  console.log(`Found ${factors.length} rows in emission_factors.`);

  if (factors.length === 0) {
    console.log("No rows found. Nothing to embed.");
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < factors.length; i += 1) {
    const factor = factors[i];
    const text = buildEmbeddingText(factor);
    const progress = `[${i + 1}/${factors.length}] id=${factor.id}`;

    try {
      console.log(`${progress} Generating embedding...`);
      const res = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
      });

      const vector = res.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error("OpenAI returned an empty embedding vector");
      }

      const { error: updateError } = await supabase
        .from("emission_factors")
        .update({ [EMBEDDING_COLUMN]: vector })
        .eq("id", factor.id);

      if (updateError) throw updateError;

      success += 1;
      console.log(`${progress} Updated ${EMBEDDING_COLUMN} (${vector.length} dims).`);
    } catch (err) {
      failed += 1;
      console.error(`${progress} Failed:`, err.message || err);
    }
  }

  console.log(
    `Done. Success: ${success}, Failed: ${failed}, Total: ${factors.length}.`
  );
}

main().catch((err) => {
  console.error("Fatal error while generating embeddings:", err.message || err);
  process.exitCode = 1;
});
