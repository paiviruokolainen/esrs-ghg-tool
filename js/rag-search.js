import OpenAI from "openai";
import { supabase } from "./supabase.js";

const EMBEDDING_MODEL = "text-embedding-3-small";

function getOpenAiClient() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_OPENAI_API_KEY.");
  }
  return new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

export async function searchEmissionFactors(queryText, matchCount = 3) {
  const query = String(queryText || "").trim();
  if (!query) return [];

  const openai = getOpenAiClient();
  const emb = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });
  const queryEmbedding = emb.data?.[0]?.embedding;
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error("Embedding generation failed.");
  }

  const { data, error } = await supabase.rpc("match_emission_factors", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw error;
  return data || [];
}
