// Formula Bridge — Japan-side admins register a supplier company and its first user.
// Japan enters only the company name, contact name and email. Returns a one-time temporary password.
// action "reissue": issues a new temporary password for an existing supplier (forgotten password).
// On first sign-in the supplier accepts the agreements, sets their own password and completes the
// company profile (with logo); the app blocks everything else until they do.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "Fb-" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "unauthorized" }, 401);
  const { data: me } = await service.from("profiles").select("role").eq("id", who.user.id).single();
  if (me?.role !== "admin") return json({ error: "forbidden" }, 403);

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const s = (k: string) => String(b[k] ?? "").trim();
  const email = s("email").toLowerCase();

  // Reissue a temporary password for an existing supplier (forgotten password, or the first one never arrived).
  if (s("action") === "reissue") {
    const { data: p } = await service.from("profiles").select("id, role, company_id").eq("email", email).maybeSingle();
    if (!p || p.role === "admin" || !p.company_id) return json({ error: "not_found" }, 404);
    const password = tempPassword();
    const { error } = await service.auth.admin.updateUserById(p.id, { password, user_metadata: { must_change_password: true } });
    if (error) return json({ error: "create_failed", message: error.message }, 500);
    return json({ ok: true, user_id: p.id, email, password, reissued: true });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !s("company_name") || !s("full_name")) {
    return json({ error: "bad_request", message: "company name, contact name and email are required" }, 400);
  }
  // Never turn an administrator address into a supplier (or vice versa).
  const { data: adminHit } = await service.from("admin_emails").select("email").eq("email", email).maybeSingle();
  if (adminHit) return json({ error: "is_admin_email" }, 400);

  const password = tempPassword();
  const meta = {
    // must_change_password: the supplier sets their own password (and completes the company profile) on first sign-in.
    must_change_password: true,
    full_name: s("full_name"), title: s("title"), phone: s("phone"), whatsapp: s("whatsapp"),
    company: { name: s("company_name"), address: s("address"), website: s("website"), nib: s("nib"), halal: s("halal"), materials: s("materials") },
  };
  // Links the user to a new company unless the sign-up trigger already did.
  const link = async (uid: string) => {
    const { data: prof } = await service.from("profiles").select("company_id").eq("id", uid).maybeSingle();
    if (prof?.company_id) return null;
    const { data: co, error: e1 } = await service.from("companies").insert({ name: s("company_name"), contact_name: s("full_name"), contact_email: email }).select("id").single();
    if (e1) return "company: " + e1.message;
    const { error: e2 } = await service.from("profiles").upsert({ id: uid, role: "supplier", company_id: co.id, email, full_name: s("full_name") });
    if (e2) { await service.from("companies").delete().eq("id", co.id); return "profile: " + e2.message; }
    return null;
  };

  // The address already has an account: a real supplier (has a company) is a duplicate; an account left without a
  // company (an earlier registration that stopped halfway) is removed and created again, so that Japan can simply retry
  // (removing it also ends any session that account still had).
  const { data: existing } = await service.from("profiles").select("id, role, company_id").eq("email", email).maybeSingle();
  if (existing) {
    if (existing.role === "admin") return json({ error: "is_admin_email" }, 400);
    if (existing.company_id) return json({ error: "already_registered" }, 400);
    const { error: ed } = await service.auth.admin.deleteUser(existing.id);
    if (ed) return json({ error: "create_failed", message: ed.message }, 500);
  }

  const { data, error } = await service.auth.admin.createUser({
    email, password, email_confirm: true,
    // fb_supplier: only accounts created here get a supplier company (users cannot set app_metadata themselves).
    app_metadata: { fb_supplier: true },
    user_metadata: meta,
  });
  if (error) return json({ error: /already|registered|exists/i.test(error.message) ? "already_registered" : "create_failed", message: error.message }, 400);
  // Supabase may add app_metadata after the user row is inserted, so the sign-up trigger cannot be relied on to
  // create the company: make sure the new supplier is linked to its company here. On failure, remove the half-made
  // account so that Japan can simply register again.
  const uid = data.user.id;
  const bad = await link(uid);
  if (bad) { await service.auth.admin.deleteUser(uid); return json({ error: "create_failed", message: bad }, 500); }
  if (existing) return json({ ok: true, user_id: uid, email, password, repaired: true });
  return json({ ok: true, user_id: uid, email, password });
});
