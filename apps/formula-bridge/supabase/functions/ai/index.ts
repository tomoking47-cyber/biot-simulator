// Formula Bridge — AI proxy. Signed-in users only (verify_jwt). The API keys never leave the server.
//   provider "claude" (default): Anthropic — everything in the app; accepts PDFs / images.
//   provider "gemini": Google — market research with Google Search grounding (returns the web sources).
//   provider "openai": OpenAI — independent review of the plan draft and of translations.
//   provider "labels": Japanese label names (成分表示名称) looked up on the web and checked against the source page.
// Gemini and OpenAI are used only by the Japan-side plan builder, so they are admin-only.
// Models can be changed without a code change through the secrets OPENAI_MODEL and GEMINI_MODEL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { labelNames } from "./labels.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Long AI calls (a plan draft can take minutes): send a space every 10 s so the platform's idle timeout does not
// cut the connection, then the JSON result (leading spaces are valid JSON). Errors arrive as {"error": …} with 200.
function keepAlive(work: Promise<Response>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const t = setInterval(() => { try { c.enqueue(enc.encode(" ")); } catch { /* closed */ } }, 10_000);
      try { c.enqueue(enc.encode(await (await work).text())); }
      catch (e) { c.enqueue(enc.encode(JSON.stringify({ error: "upstream", message: String(e) }))); }
      finally { clearInterval(t); c.close(); }
    },
  });
  return new Response(stream, { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
}

const EFFORTS = new Set(["low", "medium", "high"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_FILES_CHARS = 20_000_000;

type File64 = { media_type?: string; data?: string };
type Body = { rows?: { i: number; trade?: string; idName?: string; inci?: string }[]; provider?: string; prompt?: string; effort?: string; search?: boolean; image?: File64; document?: File64; images?: File64[]; documents?: File64[] };

async function claude(prompt: string, effort: string, body: Body) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set" }, 503);
  const images = [body.image, ...(body.images ?? [])].filter((f): f is File64 => !!f?.data && IMAGE_TYPES.has(String(f.media_type))).slice(0, 8);
  const docs = [body.document, ...(body.documents ?? [])].filter((f): f is File64 => !!f?.data && f.media_type === "application/pdf").slice(0, 6);
  const size = [...images, ...docs].reduce((a, f) => a + String(f.data).length, 0);
  if (size > MAX_FILES_CHARS) return json({ error: "bad_request", message: "attached files too large" }, 400);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of images) content.push({ type: "image", source: { type: "base64", media_type: f.media_type as "image/png", data: String(f.data) } });
  for (const f of docs) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: String(f.data) } } as any);
  content.push({ type: "text", text: prompt });

  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      // Re-run on Anthropic's recommended model if a safety classifier declines.
      fallbacks: "default",
      output_config: { effort },
      messages: [{ role: "user", content }],
    } as any);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") return json({ error: "refused" }, 422);
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    if (!text.trim()) return json({ error: "empty" }, 502);
    return json({ text, model: msg.model, truncated: msg.stop_reason === "max_tokens", usage: msg.usage });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "not_configured", message: "invalid API key" }, 503);
    if (e instanceof Anthropic.BadRequestError) return json({ error: /credit balance/i.test(e.message) ? "no_credit" : "bad_request", message: e.message }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: "upstream", message: e.message }, 502);
    return json({ error: "upstream", message: String(e) }, 502);
  }
}

async function openai(prompt: string, effort: string) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json({ error: "not_configured", message: "OPENAI_API_KEY is not set" }, 503);
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-5";
  const call = (withEffort: boolean) => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], ...(withEffort ? { reasoning_effort: effort } : {}) }),
  });
  let r = await call(true);
  // Models without reasoning settings reject reasoning_effort: retry once without it.
  if (r.status === 400) { const t = await r.text(); if (/reasoning/i.test(t)) r = await call(false); else return json({ error: "bad_request", message: t.slice(0, 500) }, 400); }
  if (r.status === 401) return json({ error: "not_configured", message: "invalid OpenAI API key" }, 503);
  // 429 is either a real rate limit or "insufficient_quota" (no credit on the OpenAI account).
  if (r.status === 429) { const t = await r.text(); return json(/insufficient_quota/.test(t) ? { error: "no_credit", message: "OpenAI account has no credit (Billing)" } : { error: "rate_limited", message: t.slice(0, 300) }, 429); }
  if (!r.ok) return json({ error: "upstream", message: (await r.text()).slice(0, 500) }, 502);
  const j = await r.json();
  const text = String(j.choices?.[0]?.message?.content ?? "");
  if (!text.trim()) return json({ error: "empty" }, 502);
  return json({ text, model: j.model || model, usage: j.usage });
}

async function gemini(prompt: string, search: boolean) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "not_configured", message: "GEMINI_API_KEY is not set" }, 503);
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.1-pro-preview";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], ...(search ? { tools: [{ google_search: {} }] } : {}) }),
  });
  if (r.status === 400 || r.status === 404) return json({ error: "bad_request", message: (await r.text()).slice(0, 500) }, 400);
  if (r.status === 401 || r.status === 403) return json({ error: "not_configured", message: "invalid Gemini API key" }, 503);
  if (r.status === 429) { const t = await r.text(); return json(/RESOURCE_EXHAUSTED|quota|billing/i.test(t) && !/per ?minute/i.test(t) ? { error: "no_credit", message: t.slice(0, 300) } : { error: "rate_limited", message: t.slice(0, 300) }, 429); }
  if (!r.ok) return json({ error: "upstream", message: (await r.text()).slice(0, 500) }, 502);
  const j = await r.json();
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  if (!text.trim()) return json({ error: cand?.finishReason === "SAFETY" ? "refused" : "empty" }, 502);
  const gm = cand?.groundingMetadata ?? {};
  const sources = (gm.groundingChunks ?? []).map((c: any) => c.web).filter((w: any) => w?.uri).map((w: any) => ({ title: String(w.title ?? ""), url: String(w.uri) }));
  return json({ text, model: j.modelVersion || model, sources, queries: gm.webSearchQueries ?? [], usage: j.usageMetadata });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // verify_jwt also accepts the public anon key, so require a real signed-in user.
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const prompt = String(body.prompt ?? "");
  const provider = String(body.provider || "claude");
  if (provider !== "labels" && (!prompt || prompt.length > 400_000)) return json({ error: "bad_request", message: "prompt missing or too long" }, 400);
  const effort = EFFORTS.has(String(body.effort)) ? String(body.effort) : "medium";

  // AI costs money: only Japan-side admins and suppliers that have actually received a request may use it.
  const { data: me } = await service.from("profiles").select("role, company_id").eq("id", who.user.id).single();
  if (me?.role !== "admin") {
    if (provider !== "claude" && provider !== "labels") return json({ error: "forbidden" }, 403);
    const { count } = await service.from("assignments").select("id", { count: "exact", head: true }).eq("company_id", me?.company_id ?? "").neq("status", "draft");
    if (!count) return json({ error: "forbidden", message: "AI is available after a request has been received." }, 403);
  }

  // Admin check of the AI setup: which keys are present and whether each one answers. Never returns key values.
  if (provider === "status") {
    if (me?.role !== "admin") return json({ error: "forbidden" }, 403);
    const has = { claude: !!Deno.env.get("ANTHROPIC_API_KEY"), openai: !!Deno.env.get("OPENAI_API_KEY"), gemini: !!Deno.env.get("GEMINI_API_KEY") };
    const models = { claude: "claude-opus-5", openai: Deno.env.get("OPENAI_MODEL") || "gpt-5", gemini: Deno.env.get("GEMINI_MODEL") || "gemini-3.1-pro-preview" };
    const out: Record<string, unknown> = {};
    const ping = "Reply with the single word OK.";
    const check = async (k: "claude" | "openai" | "gemini", fn: () => Promise<Response>) => {
      if (!has[k]) { out[k] = { key: false, model: models[k] }; return; }
      const r = await fn(); const j = await r.json().catch(() => ({}));
      out[k] = { key: true, model: j.model || models[k], ok: r.ok, error: r.ok ? undefined : j.error, message: r.ok ? undefined : String(j.message || "").slice(0, 200) };
    };
    await Promise.all([
      check("claude", () => claude(ping, "low", {})),
      check("openai", () => openai(ping, "low")),
      check("gemini", () => gemini(ping, false)),
    ]);
    return json(out);
  }
  if (provider === "labels") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set" }, 503);
    const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 12).map((r) => ({ i: Number(r?.i), trade: String(r?.trade ?? "").slice(0, 200), idName: String(r?.idName ?? "").slice(0, 200), inci: String(r?.inci ?? "").slice(0, 500) }));
    if (!rows.length) return json({ error: "bad_request", message: "rows missing" }, 400);
    return keepAlive((async () => {
      try { return json({ items: await labelNames(service, key, rows) }); }
      catch (e) {
        if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
        if (e instanceof Anthropic.AuthenticationError) return json({ error: "not_configured" }, 503);
        if (e instanceof Anthropic.BadRequestError) return json({ error: /credit balance/i.test(e.message) ? "no_credit" : "bad_request", message: e.message }, 400);
        return json({ error: "upstream", message: String((e as any)?.message ?? e) }, 502);
      }
    })());
  }
  if (provider === "openai") return keepAlive(openai(prompt, effort));
  if (provider === "gemini") return keepAlive(gemini(prompt, body.search !== false));
  return keepAlive(claude(prompt, effort, body));
});
