// Formula Bridge — email notifications.
//   event "request": Japan (admin) sent a request → email the supplier company its private link.
//   event "submit":  a supplier submitted → email Japan's development address.
//   event "shipped": a supplier shipped the sample → email Japan's development address with the tracking number.
//   event "feedback": Japan sent feedback → email the supplier company.
// Sends through Resend when RESEND_API_KEY is set; otherwise reports not_configured.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "unauthorized" }, 401);

  let body: { event?: string; assignment_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const { data: me } = await service.from("profiles").select("role, company_id, full_name, email").eq("id", who.user.id).single();
  const { data: a } = await service.from("assignments").select("id, status, company_id, project_id, request_snapshot, shipment, shipped_at, feedback").eq("id", body.assignment_id ?? "").single();
  if (!me || !a) return json({ error: "not_found" }, 404);
  const { data: co } = await service.from("companies").select("name, contact_name, contact_email").eq("id", a.company_id).single();
  const { data: pj } = await service.from("projects").select("name").eq("id", a.project_id).single();
  const { data: settings } = await service.from("settings").select("key, value");
  const conf = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  const appUrl = String(conf.app_url || Deno.env.get("APP_URL") || "").replace(/\/$/, "");
  const from = String(conf.from_email || Deno.env.get("FROM_EMAIL") || "Artisans Production Formula Bridge <onboarding@resend.dev>");

  let to: string[] = [], subject = "", html = "";
  if (body.event === "request") {
    if (me.role !== "admin" || a.status === "draft") return json({ error: "forbidden" }, 403);
    const { data: people } = await service.from("profiles").select("email").eq("company_id", a.company_id);
    to = [...new Set([co?.contact_email, ...(people ?? []).map((p) => p.email)].filter(Boolean) as string[])];
    const link = `${appUrl}/#/a/${a.id}`;
    const brief = String((a.request_snapshot as any)?.brief?.en ?? "");
    subject = `[Formula Bridge] New development request from Japan: ${pj?.name ?? ""}`;
    html = `<p>Dear ${esc(co?.contact_name || co?.name)},</p>
      <p>You have received a new formula development request from Artisans Production Co., Ltd. (Japan).<br>Anda menerima permintaan pengembangan formula baru dari Jepang.</p>
      <p><a href="${esc(link)}" style="display:inline-block;background:#23507A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open the request / Buka permintaan</a></p>
      <p style="color:#555">Please sign in with your registered email and password, then fill in the development page in English.</p>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(brief.slice(0, 4000))}</pre>
      <p style="color:#888;font-size:12px">This request is confidential. / Permintaan ini bersifat rahasia.</p>`;
  } else if (body.event === "submit") {
    if (me.role !== "admin" && me.company_id !== a.company_id) return json({ error: "forbidden" }, 403);
    const dev = String(conf.dev_email || Deno.env.get("DEV_EMAIL") || "");
    if (!dev) return json({ sent: false, reason: "no_dev_email" });
    to = dev.split(/[,\s]+/).filter(Boolean);
    subject = `[処方ブリッジ] ${co?.name ?? ""} から開発内容の提出がありました：${pj?.name ?? ""}`;
    html = `<p>インドネシアの ${esc(co?.name)}（担当：${esc(me.full_name || me.email)}）から、案件「${esc(pj?.name)}」の開発内容が提出されました。</p>
      <p><a href="${esc(appUrl)}/#/p/${esc(a.project_id)}" style="display:inline-block;background:#23507A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">処方ブリッジで確認する</a></p>`;
  } else if (body.event === "shipped") {
    if (me.role !== "admin" && me.company_id !== a.company_id) return json({ error: "forbidden" }, 403);
    if (!a.shipped_at) return json({ error: "not_shipped" }, 409);
    const dev = String(conf.dev_email || Deno.env.get("DEV_EMAIL") || "");
    if (!dev) return json({ sent: false, reason: "no_dev_email" });
    to = dev.split(/[,\s]+/).filter(Boolean);
    const sh = (a.shipment ?? {}) as Record<string, string>;
    subject = `[処方ブリッジ] サンプル発送完了：${co?.name ?? ""}／${pj?.name ?? ""}（追跡番号 ${sh.tracking ?? ""}）`;
    const row = (k: string, v: unknown) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${esc(v || "—")}</b></td></tr>`;
    html = `<p>インドネシアの ${esc(co?.name)} から、案件「${esc(pj?.name)}」のサンプル発送完了の連絡がありました。</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif">${row("運送会社", sh.carrier)}${row("追跡番号（トラッキング番号）", sh.tracking)}${row("発送日", sh.date)}${row("サンプル数量", sh.qty)}${row("備考", sh.note)}${row("連絡者", me.full_name || me.email)}</table>
      <p>サンプル到着後は、処方ブリッジの STEP 2 から必ずフィードバックを送ってください。</p>
      <p><a href="${esc(appUrl)}/#/p/${esc(a.project_id)}/dev" style="display:inline-block;background:#23507A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">処方ブリッジで確認する</a></p>`;
  } else if (body.event === "feedback") {
    if (me.role !== "admin" || !a.feedback || !(a.feedback as any).en) return json({ error: "forbidden" }, 403);
    const { data: people } = await service.from("profiles").select("email").eq("company_id", a.company_id);
    to = [...new Set([co?.contact_email, ...(people ?? []).map((p) => p.email)].filter(Boolean) as string[])];
    const fb = a.feedback as Record<string, string>;
    subject = `[Formula Bridge] Feedback from Japan: ${pj?.name ?? ""}`;
    html = `<p>Dear ${esc(co?.contact_name || co?.name)},</p><p>Artisans Production Co., Ltd. (Japan) has sent feedback on your sample. / Jepang telah mengirim umpan balik atas sampel Anda.</p>
      <p><b>Decision / Keputusan:</b> ${esc(fb.decision_en || "")}</p>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(fb.en)}</pre>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(fb.id || "")}</pre>
      <p><a href="${esc(appUrl)}/#/a/${esc(a.id)}" style="display:inline-block;background:#23507A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open in Formula Bridge</a></p>`;
  } else {
    return json({ error: "bad_request" }, 400);
  }
  if (!to.length) return json({ sent: false, reason: "no_recipient" });

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    await service.from("mail_log").insert({ kind: body.event, to_email: to.join(","), subject, ok: false, detail: "RESEND_API_KEY not set" });
    return json({ sent: false, reason: "not_configured", to });
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const detail = await r.text();
  await service.from("mail_log").insert({ kind: body.event, to_email: to.join(","), subject, ok: r.ok, detail: detail.slice(0, 500) });
  return json(r.ok ? { sent: true, to } : { sent: false, reason: "send_failed", to });
});
