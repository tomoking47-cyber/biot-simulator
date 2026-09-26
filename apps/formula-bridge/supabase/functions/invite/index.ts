// Formula Bridge — invite a Japan-side administrator by email (Supabase Auth invitation).
// Admins only, and only for addresses already on the admin allow-list.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await service.auth.getUser(jwt);
  if (!who?.user) return json({ error: "unauthorized" }, 401);
  const { data: me } = await service.from("profiles").select("role").eq("id", who.user.id).single();
  if (me?.role !== "admin") return json({ error: "forbidden" }, 403);

  let body: { email?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  const { data: allowed } = await service.from("admin_emails").select("email").eq("email", email).maybeSingle();
  if (!email || !allowed) return json({ error: "not_allowed", message: "Add the address to the administrator list first." }, 400);

  const { data: settings } = await service.from("settings").select("key, value").eq("key", "app_url");
  const appUrl = String(settings?.[0]?.value || "").replace(/\/$/, "");
  const { error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl ? appUrl + "/" : undefined });
  await service.from("mail_log").insert({ kind: "invite", to_email: email, subject: "Supabase invitation", ok: !error, detail: error ? error.message : "sent by Supabase Auth" });
  if (error) return json({ sent: false, reason: /registered|exists/i.test(error.message) ? "already_registered" : "send_failed", detail: error.message });
  return json({ sent: true, to: email });
});
