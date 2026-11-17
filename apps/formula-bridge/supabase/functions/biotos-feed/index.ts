// Formula Bridge → BIOT OS: a read-only feed of every project's progress, for the cosmetics development schedule.
//   Server to server: header "x-biotos-token" must equal the secret BIOTOS_FEED_TOKEN (BIOT OS keeps the same value
//   on its side). Without the secret set, the feed is closed (503).
//   Japan-side admins can preview the same feed from the app (signed in, two-step sign-in passed).
// Never in the feed: costs, prices, the suppliers' cost quotes, contact details, files. Suppliers never call this.
// Data flows one way only: BIOT OS reads, nothing is written here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-biotos-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// Both sides hashed first, then every byte compared: the time taken says nothing about the token.
async function sameToken(a: string, b: string) {
  const h = async (v: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const minDate = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort()[0] ?? null;
const maxDate = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().at(-1) ?? null;
const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

// The stage BIOT OS shows on the schedule, from the furthest point the project has reached.
const STAGES: Record<string, string> = {
  draft: "依頼準備中", requested: "仕入先が開発中", submitted: "提出あり・確認中", feedback: "フィードバック済み",
  adopted: "採用決定", finalized: "完成処方確定", plan: "企画書作成済み",
};

export async function buildFeed(service: any, appUrl: string) {
  const [{ data: projects, error }, { data: companies }] = await Promise.all([
    service.from("projects").select("id, name, request, created_at, updated_at, assignments(id, company_id, status, requested_at, submitted_at, shipped_at, feedback, feedback_at), finals(adopted_assignment, base_formula, additions, plan, finalized_at, updated_at), plans(created_at)").order("created_at"),
    service.from("companies").select("id, name"),
  ]);
  if (error) throw error;
  const coName = (id: string) => (companies ?? []).find((c: any) => c.id === id)?.name ?? null;
  return {
    source: "formula-bridge",
    generated_at: new Date().toISOString(),
    projects: (projects ?? []).map((p: any) => {
      const r = p.request ?? {}, f = one<any>(p.finals), plan = one<any>(p.plans);
      const sent = (p.assignments ?? []).filter((a: any) => a.status !== "draft");
      const adopted = f?.adopted_assignment ? sent.find((a: any) => a.id === f.adopted_assignment) : sent.find((a: any) => String(a.feedback?.decision ?? "").startsWith("採用（"));
      const suppliers = sent.map((a: any) => {
        const dec = String(a.feedback?.decision ?? "");
        const outcome = f?.finalized_at && f.adopted_assignment ? (f.adopted_assignment === a.id ? "採用" : "不採用（他社を採用）")
          : dec.startsWith("採用（") ? "採用" : dec === "不採用" ? "不採用" : dec ? "検討中" : null;
        return { company: coName(a.company_id), status: a.status, requested_at: a.requested_at, submitted_at: a.submitted_at, shipped_at: a.shipped_at, feedback_at: a.feedback_at, decision: dec || null, outcome };
      });
      const allSubmitted = sent.length > 0 && sent.every((a: any) => a.submitted_at);
      const allFeedback = sent.length > 0 && sent.filter((a: any) => a.submitted_at).length > 0 && sent.filter((a: any) => a.submitted_at).every((a: any) => a.feedback_at);
      const stage = plan?.created_at ? "plan" : f?.finalized_at ? "finalized" : adopted ? "adopted" : allFeedback ? "feedback" : sent.some((a: any) => a.submitted_at) ? "submitted" : sent.length ? "requested" : "draft";
      const fp = f?.plan ?? {};
      const ingredients = f?.finalized_at ? [...(f.base_formula ?? []).map((x: any) => ({ ...x, src: "ベース" })), ...(f.additions ?? []).map((x: any) => ({ ...x, src: "当社追加" }))]
        .map((x: any) => ({ label_name_ja: x.ja || null, inci: x.inci || null, percent: num(x.pct), purpose: x.fn || null, source: x.src }))
        .filter((x: any) => x.label_name_ja || x.inci) : [];
      return {
        id: p.id,
        name: p.name,
        schedule_item: String(r.scheduleItem ?? "").trim() || null,
        target_month: /^\d{4}-\d{2}$/.test(r.targetMonth ?? "") ? r.targetMonth : null,
        category: r.cat || null,
        requester: r.requester || null,
        markets: Array.isArray(r.markets) ? r.markets : [],
        stage, stage_ja: STAGES[stage],
        milestones: {
          created: p.created_at,
          requested: minDate(sent.map((a: any) => a.requested_at)),
          first_submitted: minDate(sent.map((a: any) => a.submitted_at)),
          all_submitted: allSubmitted ? maxDate(sent.map((a: any) => a.submitted_at)) : null,
          first_sample_shipped: minDate(sent.map((a: any) => a.shipped_at)),
          feedback_done: allFeedback ? maxDate(sent.map((a: any) => a.feedback_at)) : null,
          adopted: adopted ? (f?.finalized_at && f.adopted_assignment === adopted.id ? f.finalized_at : adopted.feedback_at) : null,
          finalized: f?.finalized_at ?? null,
          plan_created: plan?.created_at ?? null,
        },
        last_activity: maxDate([p.updated_at, f?.updated_at, plan?.created_at, ...sent.flatMap((a: any) => [a.requested_at, a.submitted_at, a.shipped_at, a.feedback_at])]),
        suppliers,
        adopted_company: adopted ? coName(adopted.company_id) : null,
        final: f?.finalized_at ? {
          product_name: fp.productName || null, brand: fp.brand || null, launch: fp.launch || null, channel: fp.channel || null,
          ingredients,
        } : null,
        url: `${appUrl}/#/p/${p.id}/req`,
      };
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = req.headers.get("x-biotos-token") ?? "";
  if (token) {
    const secret = Deno.env.get("BIOTOS_FEED_TOKEN") ?? "";
    if (secret.length < 32) return json({ error: "not_configured" }, 503);
    if (!(await sameToken(token, secret))) return json({ error: "unauthorized" }, 401);
  } else {
    // Preview from the app: a signed-in Japan-side admin who passed the emailed code.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await service.auth.getUser(jwt);
    if (!who?.user) return json({ error: "unauthorized" }, 401);
    { let sid = ""; try { sid = String(JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id || ""); } catch { /* no session id */ }
      if (!(await service.from("mfa_sessions").select("session_id").eq("session_id", sid).eq("user_id", who.user.id).maybeSingle()).data) return json({ error: "mfa_required" }, 401); }
    const { data: me } = await service.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    if (me?.role !== "admin") return json({ error: "forbidden" }, 403);
  }

  const { data: s } = await service.from("settings").select("value").eq("key", "app_url").maybeSingle();
  const appUrl = String(s?.value || Deno.env.get("APP_URL") || "https://formula-bridge-eight.vercel.app").replace(/\/+$/, "");
  try {
    const feed = await buildFeed(service, appUrl);
    // The app's preview also says whether BIOT OS can connect yet (never the value).
    return json(token ? feed : { ...feed, token_configured: (Deno.env.get("BIOTOS_FEED_TOKEN") ?? "").length >= 32 });
  }
  catch (e) { return json({ error: "failed", message: String((e as any)?.message ?? e).slice(0, 200) }, 500); }
});
