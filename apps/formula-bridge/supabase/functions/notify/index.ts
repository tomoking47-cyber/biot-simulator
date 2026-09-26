// Formula Bridge — email notifications.
//   event "request": Japan (admin) sent a request → email the supplier company its private link.
//   event "submit":  a supplier submitted → email Japan's development address.
//   event "shipped": a supplier shipped the sample → email Japan's development address with the tracking number.
//   event "feedback": Japan sent feedback → email the supplier company.
//   event "test":     an admin checks the mail setup → email Japan's development address.
// Sends through the company's own mail server when SMTP_HOST is set (port 465, SSL; nodemailer encodes Japanese
// subjects correctly), otherwise through Resend when RESEND_API_KEY is set; otherwise reports not_configured.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { Buffer } from "node:buffer";

type Att = { filename: string; content: Uint8Array; contentType: string };
function b64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
// Anything that ends up in a mail header: no line breaks (header injection), bounded length.
const hdr = (v: unknown) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);
async function sendMail(from: string, to: string[], subject: string, html: string, atts: Att[] = []): Promise<{ ok: boolean; detail: string } | null> {
  subject = hdr(subject);
  const host = Deno.env.get("SMTP_HOST");
  if (host) {
    const port = Number(Deno.env.get("SMTP_PORT") || 465);
    const tx = nodemailer.createTransport({ host, port, secure: port === 465, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, auth: { user: Deno.env.get("SMTP_USER") ?? "", pass: Deno.env.get("SMTP_PASS") ?? "" } });
    try {
      await tx.sendMail({ from, to: to.join(", "), subject, html, attachments: atts.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
      return { ok: true, detail: "smtp" + (atts.length ? ` (+${atts.length} files)` : "") };
    }
    catch (e) { return { ok: false, detail: "smtp: " + String(e) }; }
    finally { try { tx.close(); } catch { /* already closed */ } }
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return null;
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, ...(atts.length ? { attachments: atts.map((a) => ({ filename: a.filename, content: b64(a.content) })) } : {}) }),
  });
  } catch (e) { return { ok: false, detail: "resend: " + String(e) }; }
  return { ok: r.ok, detail: (await r.text()).slice(0, 500) };
}

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

  if (body.event === "test") {
    const { data: me } = await service.from("profiles").select("role").eq("id", who.user.id).single();
    if (me?.role !== "admin") return json({ error: "forbidden" }, 403);
    const { data: settings } = await service.from("settings").select("key, value");
    const conf = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
    const to = String(conf.dev_email || Deno.env.get("DEV_EMAIL") || "").split(/[,\s]+/).filter(Boolean);
    if (!to.length) return json({ sent: false, reason: "no_dev_email" });
    const from = String(conf.from_email || Deno.env.get("FROM_EMAIL") || "Artisans Production Formula Bridge <onboarding@resend.dev>");
    const sender = Deno.env.get("SMTP_HOST") ? String(Deno.env.get("SMTP_FROM") || from) : from;
    const subject = "[処方ブリッジ] テストメール（送信設定の確認）";
    const res = await sendMail(sender, to, subject, `<p>処方ブリッジからのテストメールです。このメールが届いていれば、メール送信の設定は完了しています。</p><p>送信元：${esc(sender)}<br>送信日時：${esc(new Date().toISOString())}</p>`);
    await service.from("mail_log").insert({ kind: "test", to_email: to.join(","), subject, ok: !!res?.ok, detail: res ? res.detail : "mail server not configured" });
    return json(res ? (res.ok ? { sent: true, to } : { sent: false, reason: "send_failed", detail: res.detail }) : { sent: false, reason: "not_configured" });
  }

  const { data: me } = await service.from("profiles").select("role, company_id, full_name, email").eq("id", who.user.id).single();
  const { data: a } = await service.from("assignments").select("id, status, company_id, project_id, request_snapshot, supplier, shipment, shipped_at, feedback").eq("id", body.assignment_id ?? "").single();
  if (!me || !a) return json({ error: "not_found" }, 404);
  const { data: co } = await service.from("companies").select("name, contact_name, contact_email").eq("id", a.company_id).single();
  const { data: pj } = await service.from("projects").select("name").eq("id", a.project_id).single();
  const { data: settings } = await service.from("settings").select("key, value");
  const conf = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  // Links in the mail need the site address: the setting, else the page the request came from.
  const appUrl = String(conf.app_url || Deno.env.get("APP_URL") || req.headers.get("origin") || "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(appUrl)) return json({ sent: false, reason: "no_app_url" });
  const from = String(conf.from_email || Deno.env.get("FROM_EMAIL") || "Artisans Production Formula Bridge <onboarding@resend.dev>");

  let to: string[] = [], subject = "", html = "";
  const atts: Att[] = [];
  if (body.event === "request") {
    if (me.role !== "admin" || a.status === "draft") return json({ error: "forbidden" }, 403);
    const { data: people } = await service.from("profiles").select("email").eq("company_id", a.company_id);
    to = [...new Set([co?.contact_email, ...(people ?? []).map((p) => p.email)].filter(Boolean) as string[])];
    const link = `${appUrl}/#/a/${a.id}`;
    const brief = String((a.request_snapshot as any)?.brief?.en ?? ""), briefId = String((a.request_snapshot as any)?.brief?.id ?? "");
    subject = `[Formula Bridge] New development request from Japan / Permintaan pengembangan baru dari Jepang: ${pj?.name ?? ""}`;
    html = `<p>Dear ${esc(co?.contact_name || co?.name)}, / Yth. ${esc(co?.contact_name || co?.name)},</p>
      <p>You have received a new formula development request from Artisans Production Co., Ltd. (Japan).<br>Anda telah menerima permintaan pengembangan formula baru dari Artisans Production Co., Ltd. (Jepang).</p>
      <p><a href="${esc(link)}" style="display:inline-block;background:#1E1C19;color:#fff;padding:11px 22px;border-radius:2px;letter-spacing:.08em;text-decoration:none">Open the request / Buka permintaan</a></p>
      ${(a.request_snapshot as any)?.request?.requester ? `<p>Requested by / Diminta oleh: <b>${esc((a.request_snapshot as any).request.requester)}</b> (Artisans Production Co., Ltd.)</p>` : ""}
      <p style="color:#555">Please sign in with your registered email and password, then fill in the development page in English.<br>Silakan masuk dengan email dan kata sandi terdaftar Anda, lalu isi halaman pengembangan dalam bahasa Inggris.</p>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(brief.slice(0, 4000))}</pre>
      ${briefId ? `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(briefId.slice(0, 4000))}</pre>` : ""}
      <p style="color:#888;font-size:12px">This request is confidential. / Permintaan ini bersifat rahasia.</p>`;
  } else if (body.event === "submit") {
    if (me.role !== "admin" && me.company_id !== a.company_id) return json({ error: "forbidden" }, 403);
    if (a.status !== "submitted") return json({ error: "not_submitted" }, 409);
    const dev = String(conf.dev_email || Deno.env.get("DEV_EMAIL") || "");
    if (!dev) return json({ sent: false, reason: "no_dev_email" });
    to = dev.split(/[,\s]+/).filter(Boolean);
    subject = `[処方ブリッジ] ${co?.name ?? ""} から開発内容の提出がありました：${pj?.name ?? ""}`;
    // The formula Excel + PDF made on submit are attached (max ~15 MB in total).
    let total = 0;
    for (const f of ((a.supplier as any)?.files ?? []).filter((f: any) => f?.auto && typeof f.path === "string" && f.path.startsWith(a.company_id + "/") && !f.path.includes("..")).slice(0, 4)) {
      const { data: blob } = await service.storage.from("attachments").download(f.path);
      if (!blob) continue;
      const u = new Uint8Array(await blob.arrayBuffer()); total += u.length; if (total > 15 * 1024 * 1024) break;
      const ext = String(f.path).endsWith(".pdf") ? "pdf" : "xlsx";
      atts.push({ filename: (String(f.name || "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "formula") .replace(/\.(pdf|xlsx)$/i, "") + "." + ext,
        content: u, contentType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
    html = `<p>インドネシアの ${esc(co?.name)}（担当：${esc(me.full_name || me.email)}）から、案件「${esc(pj?.name)}」の開発内容が提出されました。</p>
      ${atts.length ? `<p>処方表（Excel・PDF）を添付しています：${atts.map((x) => esc(x.filename)).join("、")}</p>` : ""}
      <p><a href="${esc(appUrl)}/#/p/${esc(a.project_id)}" style="display:inline-block;background:#1E1C19;color:#fff;padding:11px 22px;border-radius:2px;letter-spacing:.08em;text-decoration:none">処方ブリッジで確認する</a></p>`;
  } else if (body.event === "shipped") {
    if (me.role !== "admin" && me.company_id !== a.company_id) return json({ error: "forbidden" }, 403);
    if (!a.shipped_at) return json({ error: "not_shipped" }, 409);
    const dev = String(conf.dev_email || Deno.env.get("DEV_EMAIL") || "");
    if (!dev) return json({ sent: false, reason: "no_dev_email" });
    to = dev.split(/[,\s]+/).filter(Boolean);
    const sh = (a.shipment ?? {}) as Record<string, string>;
    subject = `[処方ブリッジ] サンプル発送完了：${co?.name ?? ""}／${pj?.name ?? ""}${sh.tracking ? `（追跡番号 ${sh.tracking}）` : ""}`;
    const row = (k: string, v: unknown) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${esc(v || "—")}</b></td></tr>`;
    html = `<p>インドネシアの ${esc(co?.name)} から、案件「${esc(pj?.name)}」のサンプル発送完了の連絡がありました。</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif">${row("運送会社", sh.carrier)}${row("追跡番号", sh.tracking)}${row("発送日", sh.date)}${row("サンプル数量", sh.qty)}${row("備考", sh.note)}${row("連絡者", me.full_name || me.email)}</table>
      <p>サンプル到着後は、処方ブリッジの STEP 2 から必ずフィードバックを送ってください。</p>
      <p><a href="${esc(appUrl)}/#/p/${esc(a.project_id)}/dev" style="display:inline-block;background:#1E1C19;color:#fff;padding:11px 22px;border-radius:2px;letter-spacing:.08em;text-decoration:none">処方ブリッジで確認する</a></p>`;
  } else if (body.event === "feedback") {
    if (me.role !== "admin") return json({ error: "forbidden" }, 403);
    if (!(a.feedback as any)?.en) return json({ error: "no_feedback" }, 409);
    const { data: people } = await service.from("profiles").select("email").eq("company_id", a.company_id);
    to = [...new Set([co?.contact_email, ...(people ?? []).map((p) => p.email)].filter(Boolean) as string[])];
    const fb = a.feedback as Record<string, string>;
    subject = `[Formula Bridge] Feedback from Japan / Umpan balik dari Jepang: ${pj?.name ?? ""}`;
    const decId = fb.decision_id || ({ "採用候補": "Kandidat untuk diadopsi", "再試作を依頼": "Mohon lakukan revisi dan kirimkan sampel baru", "不採用": "Tidak diadopsi kali ini", "採用（本処方は当社に帰属）": "Diadopsi — sesuai perjanjian Kepemilikan Formula yang Diadopsi, formula ini kini menjadi milik Artisans Production Co., Ltd." } as Record<string, string>)[fb.decision] || "";
    html = `<p>Dear ${esc(co?.contact_name || co?.name)}, / Yth. ${esc(co?.contact_name || co?.name)},</p><p>Artisans Production Co., Ltd. (Japan) has sent feedback on your sample.<br>Artisans Production Co., Ltd. (Jepang) telah mengirimkan umpan balik atas sampel Anda.</p>
      <p><b>Decision / Keputusan:</b> ${esc(fb.decision_en || "")}${decId ? ` / ${esc(decId)}` : ""}</p>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(fb.en)}</pre>
      ${fb.id ? `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f4f6f8;padding:12px;border-radius:6px">${esc(fb.id)}</pre>` : ""}
      <p><a href="${esc(appUrl)}/#/a/${esc(a.id)}" style="display:inline-block;background:#1E1C19;color:#fff;padding:11px 22px;border-radius:2px;letter-spacing:.08em;text-decoration:none">Open in Formula Bridge / Buka di Formula Bridge</a></p>`;
  } else {
    return json({ error: "bad_request" }, 400);
  }
  if (!to.length) return json({ sent: false, reason: "no_recipient" });

  // With the company's own server the sender must be an address on that server (SMTP_FROM).
  const sender = Deno.env.get("SMTP_HOST") ? String(Deno.env.get("SMTP_FROM") || from) : from;
  const res = await sendMail(sender, to, subject, html, atts);
  if (!res) {
    await service.from("mail_log").insert({ kind: body.event, to_email: to.join(","), subject, ok: false, detail: "mail server not configured" });
    return json({ sent: false, reason: "not_configured", to });
  }
  await service.from("mail_log").insert({ kind: body.event, to_email: to.join(","), subject, ok: res.ok, detail: res.detail });
  return json(res.ok ? { sent: true, to } : { sent: false, reason: "send_failed", to });
});
