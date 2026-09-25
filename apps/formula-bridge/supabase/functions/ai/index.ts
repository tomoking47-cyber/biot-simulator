// Formula Bridge — AI proxy. Signed-in users only (verify_jwt). The API key never leaves the server.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EFFORTS = new Set(["low", "medium", "high"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // verify_jwt also accepts the public anon key, so require a real signed-in user.
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "unauthorized" }, 401);
  // AI costs money: only Japan-side admins and suppliers that have actually received a request may use it.
  const { data: me } = await service.from("profiles").select("role, company_id").eq("id", who.user.id).single();
  if (me?.role !== "admin") {
    const { count } = await service.from("assignments").select("id", { count: "exact", head: true }).eq("company_id", me?.company_id ?? "").neq("status", "draft");
    if (!count) return json({ error: "forbidden", message: "AI is available after a request has been received." }, 403);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set" }, 503);

  let body: { prompt?: string; effort?: string; image?: { media_type?: string; data?: string } };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const prompt = String(body.prompt ?? "");
  if (!prompt || prompt.length > 200_000) return json({ error: "bad_request", message: "prompt missing or too long" }, 400);
  const effort = EFFORTS.has(String(body.effort)) ? String(body.effort) : "medium";

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (body.image?.data && IMAGE_TYPES.has(String(body.image.media_type))) {
    content.push({ type: "image", source: { type: "base64", media_type: body.image.media_type as "image/png", data: body.image.data } });
  }
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
    return json({ text, truncated: msg.stop_reason === "max_tokens" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "not_configured", message: "invalid API key" }, 503);
    if (e instanceof Anthropic.BadRequestError) return json({ error: "bad_request", message: e.message }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: "upstream", message: e.message }, 502);
    return json({ error: "upstream", message: String(e) }, 502);
  }
});
