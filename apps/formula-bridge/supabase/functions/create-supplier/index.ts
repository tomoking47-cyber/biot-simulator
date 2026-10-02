// Formula Bridge — supplier accounts, fully by email (no temporary passwords).
//   (default)        admin: register a supplier company and its representative, and email them a sign-in link.
//   "add_member"     admin (any company) or the company's representative (own company): add a colleague and email a link.
//   "resend"         admin, or the representative for their own colleagues: email a new sign-in link.
//   "list_members"   admin, or anyone of that company: the people who can sign in for the company.
//   "remove_member"  admin, or the representative for their own colleagues: remove a person (the representative stays).
//   "link"           anyone (from the sign-in page, "Forgot password?"): emails a new sign-in link to a supplier, or a
//                    password reset email to anyone else. Always answers ok, so it does not reveal who is registered.
//   "signup"         anyone (the "Register your company" page): a supplier registers its own company and receives a
//                    sign-in link by email; Japan's development address is told. Needs a mail server (else mail_not_ready).
// The representative is the person whose address is the company's contact email.
// A sign-in link signs the person in once; the app then asks them to accept the agreements, set their own password and
// (the first time) complete the company profile. When no mail server is configured yet, the link is returned to the admin
// or representative instead, to be passed on by hand.
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
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const s = (k: string) => String(b[k] ?? "").trim();
  const action = s("action");
  const email = s("email").toLowerCase();

  const { data: settings } = await service.from("settings").select("key, value");
  const conf = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  // Never the request's Origin header: links must always point at our own site.
  const appUrl = String(conf.app_url || Deno.env.get("APP_URL") || "https://formula-bridge-eight.vercel.app").replace(/\/$/, "");
  const from = String(conf.from_email || Deno.env.get("FROM_EMAIL") || "Artisans Production Formula Bridge <onboarding@resend.dev>");
  const sender = Deno.env.get("SMTP_HOST") ? String(Deno.env.get("SMTP_FROM") || from) : from;

  // Makes a one-time sign-in link for a supplier and emails it. Returns { emailed, link? } — the link only when it could not be emailed.
  const invite = async (uid: string, to: string, name: string, company: string, kind: "new" | "member" | "again", by = "") => {
    await service.auth.admin.updateUserById(uid, { user_metadata: { must_change_password: true } });
    const { data, error } = await service.auth.admin.generateLink({ type: "magiclink", email: to, options: { redirectTo: appUrl + "/" } });
    if (error || !data?.properties?.action_link) throw new Error("link: " + (error?.message || "no link"));
    const link = data.properties.action_link;
    const hi = `Dear ${esc(name || "Sir/Madam")}, / Yth. ${esc(name || "Bapak/Ibu")},`;
    const why = kind === "again"
      ? `<p>Here is a new sign-in link for Formula Bridge. After signing in, please set your password again.<br>Berikut tautan masuk baru untuk Formula Bridge. Setelah masuk, silakan buat kata sandi Anda kembali.</p>`
      : `<p>${kind === "member" && by ? `${esc(by)} has added you` : "Artisans Production Co., Ltd. (Japan) has added you"} to Formula Bridge for <b>${esc(company)}</b> — our platform for formula development requests.<br>
         ${kind === "member" && by ? `${esc(by)} telah menambahkan Anda` : "Artisans Production Co., Ltd. (Jepang) telah menambahkan Anda"} ke Formula Bridge untuk <b>${esc(company)}</b> — platform permintaan pengembangan formula kami.</p>
         <p>Press the button below. You will be asked to accept the agreements and set your own password${kind === "new" ? ", then complete your company profile" : ""}.<br>
         Tekan tombol di bawah. Anda akan diminta menyetujui perjanjian dan membuat kata sandi sendiri${kind === "new" ? ", lalu melengkapi profil perusahaan" : ""}.</p>`;
    const html = `<p>${hi}</p>${why}
      <p><a href="${esc(link)}" style="display:inline-block;background:#1E1C19;color:#fff;padding:11px 22px;border-radius:2px;letter-spacing:.08em;text-decoration:none">Sign in to Formula Bridge / Masuk ke Formula Bridge</a></p>
      <p style="color:#555">The button works once and for a limited time. Later, sign in at ${esc(appUrl)} with your email and password. If the button no longer works, open ${esc(appUrl)}, press “Forgot password? / Lupa kata sandi?” and enter your email to receive a new link.<br>
      Tombol ini hanya berlaku satu kali dan untuk waktu terbatas. Selanjutnya, masuk di ${esc(appUrl)} dengan email dan kata sandi Anda. Jika tombol tidak berfungsi lagi, buka ${esc(appUrl)}, tekan “Forgot password? / Lupa kata sandi?”, lalu masukkan email Anda untuk menerima tautan baru.</p>
      <p style="color:#555">User guide / Panduan: <a href="${esc(appUrl)}/guide/supplier.html">${esc(appUrl)}/guide/supplier.html</a></p>
      <p style="color:#888;font-size:12px">This invitation is confidential. If you did not expect it, please ignore this email. / Undangan ini bersifat rahasia. Jika Anda tidak mengharapkannya, abaikan email ini.</p>`;
    const subject = kind === "again" ? "[Formula Bridge] Your new sign-in link / Tautan masuk baru Anda" : `[Formula Bridge] Invitation from Artisans Production / Undangan dari Artisans Production — ${company}`;
    const res = await sendMail(sender, [to], subject, html);
    await service.from("mail_log").insert({ kind: "account", to_email: to, subject, ok: !!res?.ok, detail: res ? res.detail : "mail server not configured" });
    return res?.ok ? { emailed: true } : { emailed: false, link, reason: res ? "send_failed" : "not_configured" };
  };

  // ---- "Forgot password?" from the sign-in page (no sign-in needed) ----
  if (action === "link") {
    if (!EMAIL.test(email)) return json({ ok: true });
    // At most 3 emails per address per hour, so the form cannot be used to flood someone's inbox.
    const { count } = await service.from("mail_log").select("id", { count: "exact", head: true }).eq("to_email", email).in("kind", ["account", "reset"]).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
    if ((count ?? 0) >= 3) return json({ ok: true });
    const { data: p } = await service.from("profiles").select("id, role, company_id, full_name").eq("email", email).maybeSingle();
    if (p && p.role !== "admin" && p.company_id) {
      const { data: co } = await service.from("companies").select("name").eq("id", p.company_id).maybeSingle();
      try { await invite(p.id, email, p.full_name || "", co?.name || "", "again"); } catch (e) { console.error(e); }
    } else if (p) {
      const { error } = await service.auth.resetPasswordForEmail(email, { redirectTo: appUrl + "/" });
      await service.from("mail_log").insert({ kind: "reset", to_email: email, subject: "Supabase password reset", ok: !error, detail: error ? error.message : "sent by Supabase Auth" });
    }
    return json({ ok: true });
  }

  // ---- Self-registration of a new supplier company (no sign-in needed) ----
  // The person proves the address is theirs by using the emailed link. A new company sees nothing until Japan sends it a
  // request, and AI and file attachments stay off until then, so a stranger who registers gains nothing.
  if (action === "signup") {
    if (!EMAIL.test(email) || !s("company_name") || !s("full_name") || s("company_name").length > 200 || s("full_name").length > 120) return json({ error: "bad_request" }, 400);
    if (!Deno.env.get("SMTP_HOST") && !Deno.env.get("RESEND_API_KEY")) return json({ error: "mail_not_ready" }, 503);
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const [{ count: mine }, { count: all }] = await Promise.all([
      service.from("mail_log").select("id", { count: "exact", head: true }).eq("to_email", email).in("kind", ["account", "reset"]).gte("created_at", hourAgo),
      service.from("mail_log").select("id", { count: "exact", head: true }).eq("kind", "signup").gte("created_at", hourAgo),
    ]);
    if ((mine ?? 0) >= 3 || (all ?? 0) >= 20) return json({ error: "too_many" }, 429);
    // An address that already has an account gets a sign-in link instead (the answer is the same, so it reveals nothing).
    const { data: ex } = await service.from("profiles").select("id, role, company_id, full_name").eq("email", email).maybeSingle();
    const isAdm = (!!ex && ex.role === "admin") || !!(await service.from("admin_emails").select("email").eq("email", email).maybeSingle()).data;
    if (isAdm) return json({ ok: true });
    if (ex?.company_id) {
      const { data: co } = await service.from("companies").select("name").eq("id", ex.company_id).maybeSingle();
      try { await invite(ex.id, email, ex.full_name || "", co?.name || "", "again"); } catch (e) { console.error(e); }
      return json({ ok: true });
    }
    if (ex) await service.auth.admin.deleteUser(ex.id); // an account left without a company (stopped halfway)
    const { data, error } = await service.auth.admin.createUser({ email, email_confirm: true, app_metadata: { fb_supplier: true },
      user_metadata: { must_change_password: true, full_name: s("full_name"), company: { name: s("company_name") }, self_registered: true } });
    if (error) return json({ error: "create_failed" }, 500);
    const uid = data.user.id;
    const { data: prof } = await service.from("profiles").select("company_id").eq("id", uid).maybeSingle();
    let newCid = prof?.company_id as string | undefined;
    if (!newCid) {
      const { data: co, error: e1 } = await service.from("companies").insert({ name: s("company_name"), contact_name: s("full_name"), contact_email: email }).select("id").single();
      const { error: e2 } = e1 ? { error: e1 } : await service.from("profiles").upsert({ id: uid, role: "supplier", company_id: co.id, email, full_name: s("full_name") });
      if (e1 || e2) { if (co) await service.from("companies").delete().eq("id", co.id); await service.auth.admin.deleteUser(uid); return json({ error: "create_failed" }, 500); }
      newCid = co.id;
    }
    let sent = false;
    try { sent = !!(await invite(uid, email, s("full_name"), s("company_name"), "new")).emailed; } catch (e) { console.error(e); }
    if (!sent) { // nothing half-made is left behind
      await service.auth.admin.deleteUser(uid); await service.from("companies").delete().eq("id", newCid);
      return json({ error: "mail_failed" }, 502);
    }
    await service.from("mail_log").insert({ kind: "signup", to_email: email, subject: "self-registration: " + s("company_name"), ok: true, detail: "" });
    // Tell Japan's development address (information only — nothing to do).
    const dev = String(conf.dev_email || Deno.env.get("DEV_EMAIL") || "").split(/[,\s]+/).filter(Boolean);
    if (dev.length) {
      const subj = `[処方ブリッジ] 新しい仕入先が登録しました：${s("company_name")}`;
      const r = await sendMail(sender, dev, subj, `<p>インドネシアの仕入先が、処方ブリッジに自分で登録しました（対応は不要です）。</p>
        <p>会社名：<b>${esc(s("company_name"))}</b><br>担当者：${esc(s("full_name"))}<br>メール：${esc(email)}</p>
        <p>この会社に依頼を送るまで、相手は何も見られません（AI・ファイル添付も使えません）。心当たりのない登録は「登録企業」から確認してください。</p>
        <p><a href="${esc(appUrl)}/#/companies">処方ブリッジで確認する</a></p>`);
      await service.from("mail_log").insert({ kind: "signup_notice", to_email: dev.join(","), subject: subj, ok: !!r?.ok, detail: r ? r.detail : "mail server not configured" });
    }
    return json({ ok: true });
  }

  // ---- everything else needs a signed-in admin or supplier ----
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "unauthorized" }, 401);
  const { data: me } = await service.from("profiles").select("id, role, company_id, email, full_name").eq("id", who.user.id).single();
  if (!me) return json({ error: "forbidden" }, 403);
  const isAdmin = me.role === "admin";

  const companyOf = async (cid: string) => (await service.from("companies").select("id, name, contact_email, contact_name").eq("id", cid).maybeSingle()).data;
  const isRep = (co: { contact_email?: string | null } | null, mail?: string | null) => !!co && !!mail && String(co.contact_email || "").toLowerCase() === String(mail).toLowerCase();
  // The company an action is about, and whether the caller may manage its people.
  const scope = async () => {
    const cid = isAdmin ? s("company_id") : me.company_id;
    const co = cid ? await companyOf(cid) : null;
    return { co, canManage: !!co && (isAdmin || isRep(co, me.email)), canSee: !!co && (isAdmin || me.company_id === co.id) };
  };
  // Removes an account that was left without a company (a registration that stopped halfway), so it can be made again.
  const clearHalfMade = async () => {
    const { data: ex } = await service.from("profiles").select("id, role, company_id").eq("email", email).maybeSingle();
    if (!ex) return null;
    if (ex.role === "admin") return "is_admin_email";
    if (ex.company_id) return "already_registered";
    const { error } = await service.auth.admin.deleteUser(ex.id);
    return error ? "create_failed" : null;
  };
  const isAdminEmail = async () => !!(await service.from("admin_emails").select("email").eq("email", email).maybeSingle()).data;

  if (action === "list_members") {
    const { co, canSee, canManage } = await scope();
    if (!canSee) return json({ error: "forbidden" }, 403);
    const { data: ps } = await service.from("profiles").select("id, email, full_name, created_at").eq("company_id", co!.id).order("created_at");
    const members = [];
    for (const p of ps ?? []) {
      const { data: u } = await service.auth.admin.getUserById(p.id);
      members.push({ id: p.id, email: p.email, full_name: p.full_name, rep: isRep(co, p.email), joined: !!u?.user && !u.user.user_metadata?.must_change_password, last_sign_in_at: u?.user?.last_sign_in_at ?? null, created_at: p.created_at });
    }
    return json({ ok: true, company: { id: co!.id, name: co!.name }, can_manage: canManage, me: me.id, members });
  }

  if (action === "add_member") {
    const { co, canManage } = await scope();
    if (!canManage) return json({ error: "forbidden" }, 403);
    if (!EMAIL.test(email) || !s("full_name")) return json({ error: "bad_request" }, 400);
    if (await isAdminEmail()) return json({ error: "is_admin_email" }, 400);
    const stop = await clearHalfMade(); if (stop) return json({ error: stop }, stop === "create_failed" ? 500 : 400);
    // Not marked fb_supplier, so the sign-up trigger does not create a second company; linked to this company below.
    const { data, error } = await service.auth.admin.createUser({ email, email_confirm: true, user_metadata: { must_change_password: true, full_name: s("full_name") } });
    if (error) { const dup = /already|registered|exists/i.test(error.message); return json({ error: dup ? "already_registered" : "create_failed", message: error.message }, dup ? 400 : 500); }
    const uid = data.user.id;
    const { error: e2 } = await service.from("profiles").upsert({ id: uid, role: "supplier", company_id: co!.id, email, full_name: s("full_name") });
    if (e2) { await service.auth.admin.deleteUser(uid); return json({ error: "create_failed", message: e2.message }, 500); }
    try { return json({ ok: true, email, ...(await invite(uid, email, s("full_name"), co!.name, "member", isAdmin ? "" : (me.full_name || me.email))) }); }
    catch (e) { return json({ ok: true, email, emailed: false, reason: "link_failed", message: String(e) }); }
  }

  if (action === "resend" || action === "remove_member") {
    const { data: p } = await service.from("profiles").select("id, role, company_id, email, full_name").eq("email", email).maybeSingle();
    if (!p || p.role === "admin" || !p.company_id) return json({ error: "not_found" }, 404);
    const co = await companyOf(p.company_id);
    if (!(isAdmin || (me.company_id === p.company_id && isRep(co, me.email)))) return json({ error: "forbidden" }, 403);
    if (action === "resend") {
      try { return json({ ok: true, email, ...(await invite(p.id, email, p.full_name || "", co?.name || "", "again")) }); }
      catch (e) { return json({ error: "create_failed", message: String(e) }, 500); }
    }
    // The representative stays (Japan changes the representative by changing the company's contact email first).
    if (isRep(co, p.email)) return json({ error: "is_representative" }, 400);
    if (p.id === me.id) return json({ error: "is_self" }, 400);
    const { error } = await service.auth.admin.deleteUser(p.id); // also ends their sessions; their agreement records stay (user set to null)
    if (error) return json({ error: "create_failed", message: error.message }, 500);
    return json({ ok: true, removed: email });
  }

  // ---- register a new supplier company (admins only) ----
  if (!isAdmin) return json({ error: "forbidden" }, 403);
  if (action) return json({ error: "bad_request" }, 400);
  if (!EMAIL.test(email) || !s("company_name") || !s("full_name")) {
    return json({ error: "bad_request", message: "company name, contact name and email are required" }, 400);
  }
  if (await isAdminEmail()) return json({ error: "is_admin_email" }, 400);
  const stop = await clearHalfMade(); if (stop) return json({ error: stop }, stop === "create_failed" ? 500 : 400);
  const { data, error } = await service.auth.admin.createUser({
    email, email_confirm: true,
    // fb_supplier: only accounts created here get a supplier company (users cannot set app_metadata themselves).
    app_metadata: { fb_supplier: true },
    user_metadata: { must_change_password: true, full_name: s("full_name"), company: { name: s("company_name") } },
  });
  if (error) { const dup = /already|registered|exists/i.test(error.message); return json({ error: dup ? "already_registered" : "create_failed", message: error.message }, dup ? 400 : 500); }
  // Supabase may add app_metadata after the user row is inserted, so the sign-up trigger cannot be relied on to create the
  // company: make sure the new supplier is linked to its company here. On failure, remove the half-made account.
  const uid = data.user.id;
  const { data: prof } = await service.from("profiles").select("company_id").eq("id", uid).maybeSingle();
  let cid = prof?.company_id as string | undefined;
  if (!cid) {
    const { data: co, error: e1 } = await service.from("companies").insert({ name: s("company_name"), contact_name: s("full_name"), contact_email: email }).select("id").single();
    const { error: e2 } = e1 ? { error: e1 } : await service.from("profiles").upsert({ id: uid, role: "supplier", company_id: co.id, email, full_name: s("full_name") });
    if (e1 || e2) { if (co) await service.from("companies").delete().eq("id", co.id); await service.auth.admin.deleteUser(uid); return json({ error: "create_failed", message: (e1 || e2)!.message }, 500); }
    cid = co.id;
  }
  try { return json({ ok: true, email, company_id: cid, ...(await invite(uid, email, s("full_name"), s("company_name"), "new")) }); }
  catch (e) { return json({ ok: true, email, company_id: cid, emailed: false, reason: "link_failed", message: String(e) }); }
});
