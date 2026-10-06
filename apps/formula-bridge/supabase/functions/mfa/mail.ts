// Formula Bridge — sending mail (same as the notify function): the company's own mail server when SMTP_HOST is set
// (port 465, SSL), otherwise Resend when RESEND_API_KEY is set; returns null when neither is configured.
import nodemailer from "npm:nodemailer@6.9.16";
import { Buffer } from "node:buffer";

export type Att = { filename: string; content: Uint8Array; contentType: string };
function b64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
// Anything that ends up in a mail header: no line breaks (header injection), bounded length.
const hdr = (v: unknown) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);
export async function sendMail(from: string, to: string[], subject: string, html: string, atts: Att[] = [], text = ""): Promise<{ ok: boolean; detail: string } | null> {
  subject = hdr(subject);
  const host = Deno.env.get("SMTP_HOST");
  if (host) {
    const port = Number(Deno.env.get("SMTP_PORT") || 465);
    const tx = nodemailer.createTransport({ host, port, secure: port === 465, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, auth: { user: Deno.env.get("SMTP_USER") ?? "", pass: Deno.env.get("SMTP_PASS") ?? "" } });
    try {
      await tx.sendMail({ from, to: to.join(", "), subject, html, ...(text ? { text } : {}), attachments: atts.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
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
    body: JSON.stringify({ from, to, subject, html, ...(text ? { text } : {}), ...(atts.length ? { attachments: atts.map((a) => ({ filename: a.filename, content: b64(a.content) })) } : {}) }),
  });
  } catch (e) { return { ok: false, detail: "resend: " + String(e) }; }
  return { ok: r.ok, detail: (await r.text()).slice(0, 500) };
}
