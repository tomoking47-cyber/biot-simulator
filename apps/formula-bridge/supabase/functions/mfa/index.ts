// Formula Bridge — two-step sign-in by email (every user, Japan and suppliers).
//   "status"  is this sign-in session verified? A session that came from an emailed link (invitation, sign-in link,
//             password reset) is verified at once: the link itself proved the mailbox.
//   "send"    emails a 6-digit code for this session (valid 10 minutes; at most 5 emails per 15 minutes).
//   "verify"  checks the code (at most 5 tries per code) and marks this session verified.
// Until a session is verified the database lets it read nothing but its own profile (see 0020_email_two_step.sql).
// While no mail server is configured at all, codes cannot be delivered, so sessions are let through (method "nomail")
// rather than locking everyone out; once SMTP or Resend is set, every new sign-in needs the code.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMail } from "./mail.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const LINK_METHODS = new Set(["otp", "magiclink", "recovery", "invite", "email/signup", "email_change"]);
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const claimsOf = (jwt: string) => { try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt); // checks the token's signature and expiry
  if (!who?.user) return json({ error: "unauthorized" }, 401);
  const claims = claimsOf(jwt), sid = String(claims.session_id || ""), uid = who.user.id, email = String(who.user.email || "");
  if (!sid) return json({ error: "unauthorized" }, 401);
  let b: Record<string, string> = {};
  try { b = await req.json(); } catch { /* empty body */ }
  const action = String(b.action || "status");

  const isVerified = async () => !!(await service.from("mfa_sessions").select("session_id").eq("session_id", sid).eq("user_id", uid).maybeSingle()).data;
  const mark = async (method: string) => { await service.from("mfa_sessions").upsert({ session_id: sid, user_id: uid, method }); await service.from("mfa_codes").delete().eq("session_id", sid); };

  if (await isVerified()) return json({ ok: true, verified: true });

  if (action === "status") {
    const amr: { method?: string }[] = Array.isArray(claims.amr) ? claims.amr : [];
    if (amr.some((a) => LINK_METHODS.has(String(a?.method)))) { await mark("email_link"); return json({ ok: true, verified: true }); }
    return json({ ok: true, verified: false, email: email.replace(/^(.{2}).*(@.*)$/, "$1…$2") });
  }

  if (action === "send") {
    if (!Deno.env.get("SMTP_HOST") && !Deno.env.get("RESEND_API_KEY")) { await mark("nomail"); return json({ ok: true, verified: true, reason: "mail_not_configured" }); }
    const { count } = await service.from("mail_log").select("id", { count: "exact", head: true }).eq("to_email", email).eq("kind", "mfa").gte("created_at", new Date(Date.now() - 15 * 60e3).toISOString());
    if ((count ?? 0) >= 5) return json({ error: "too_many" }, 429);
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000, code = String(n).padStart(6, "0");
    await service.from("mfa_codes").upsert({ session_id: sid, user_id: uid, code_hash: await sha256(sid + ":" + code), expires_at: new Date(Date.now() + 10 * 60e3).toISOString(), attempts: 0 });
    const { data: settings } = await service.from("settings").select("key, value").eq("key", "from_email");
    const from = String(settings?.[0]?.value || Deno.env.get("FROM_EMAIL") || "Formula Bridge <onboarding@resend.dev>");
    const sender = Deno.env.get("SMTP_HOST") ? String(Deno.env.get("SMTP_FROM") || from) : from;
    const subject = `[Formula Bridge] Sign-in code / Kode masuk / ログイン確認コード: ${code}`;
    const html = `<p>Your sign-in code / Kode masuk Anda / ログイン確認コード:</p>
      <p style="font-size:28px;letter-spacing:.3em;font-weight:700;font-family:monospace">${code}</p>
      <p style="color:#555">Enter it on the Formula Bridge screen within 10 minutes.<br>Masukkan di layar Formula Bridge dalam 10 menit.<br>10分以内に処方ブリッジの画面に入力してください。</p>
      <p style="color:#888;font-size:12px">If you did not try to sign in, someone may know your password: change it now and tell Artisans Production.<br>Jika Anda tidak mencoba masuk, mungkin ada orang lain yang mengetahui kata sandi Anda: segera ganti kata sandi dan beri tahu Artisans Production.<br>心当たりがない場合はパスワードが漏れている可能性があります。すぐにパスワードを変更してください。</p>`;
    const res = await sendMail(sender, [email], subject, html);
    await service.from("mail_log").insert({ kind: "mfa", to_email: email, subject: "[Formula Bridge] Sign-in code", ok: !!res?.ok, detail: res ? res.detail : "mail server not configured" });
    if (!res?.ok) return json({ error: "send_failed" }, 502);
    return json({ ok: true, sent: true });
  }

  if (action === "verify") {
    const code = String(b.code || "").replace(/\D/g, "");
    const { data: row } = await service.from("mfa_codes").select("code_hash, expires_at, attempts").eq("session_id", sid).eq("user_id", uid).maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return json({ error: "expired" }, 400);
    if (row.attempts >= 5) return json({ error: "too_many" }, 429);
    if (code.length !== 6 || (await sha256(sid + ":" + code)) !== row.code_hash) {
      await service.from("mfa_codes").update({ attempts: row.attempts + 1 }).eq("session_id", sid);
      return json({ error: "wrong_code", left: Math.max(0, 4 - row.attempts) }, 400);
    }
    await mark("email_code");
    return json({ ok: true, verified: true });
  }
  return json({ error: "bad_request" }, 400);
});
