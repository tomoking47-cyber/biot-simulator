// Japanese cosmetic label names (成分表示名称) with evidence.
// 1. Known INCI names come from the label_names table (names verified earlier).
// 2. The rest are looked up by Claude with web search / web fetch, asked to copy the name exactly from the page.
// 3. This function then opens the cited page itself and accepts a name only when the INCI name and the Japanese
//    name appear close together on that page: level "official" (jcia.org, the JCIA label name list) or "web"
//    (another page). Anything else is returned with level "none" (shown as 要確認 in the app).
// Names that Japan-side staff confirmed by eye are stored with level "manual" and reused the same way.
import Anthropic from "npm:@anthropic-ai/sdk";

type Row = { i: number; trade?: string; idName?: string; inci?: string };
type Comp = { inci: string; ja: string; level: "official" | "web" | "manual" | "none"; url: string; note: string };

export const normInci = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
// "Water (and) Glycerin" / "Water, Glycerin" → components. Slashes stay: they are part of many single INCI names
// (e.g. "Acrylates/C10-30 Alkyl Acrylate Crosspolymer"); "1,2-Hexanediol" has no space after the comma.
export const splitInci = (s: string) => s.split(/\s*\(and\)\s*|,\s+|;\s*/i).map((x) => x.trim()).filter(Boolean);
const compact = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

function parseJSON(text: string): any {
  const t = String(text).trim();
  try { return JSON.parse(t); } catch { /* try below */ }
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch { /* try below */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return {};
}

async function claudeWeb(client: Anthropic, prompt: string): Promise<string> {
  const messages: any[] = [{ role: "user", content: prompt }];
  let text = "";
  for (let turn = 0; turn < 5; turn++) {
    const msg: any = await client.messages.stream({
      model: "claude-opus-5", max_tokens: 16000, output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 15 }],
      messages,
    } as any).finalMessage();
    text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || text;
    // A long server-side search can pause; send the turn back and the API continues where it stopped.
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    if (msg.stop_reason === "refusal") throw new Error("refused");
    return text;
  }
  return text;
}

// Plain text of a web page (HTML or text; any charset), or null when it cannot be read.
const pages = new Map<string, Promise<string | null>>();
function pageText(url: string): Promise<string | null> {
  if (!pages.has(url)) pages.set(url, (async () => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname) || /(\.local|\.internal|supabase\.co)$/i.test(u.hostname)) return null;
      const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; FormulaBridge label-name check)", "Accept-Language": "ja,en;q=0.8" } });
      if (!r.ok || /pdf|image|octet/i.test(r.headers.get("content-type") ?? "")) return null;
      const buf = new Uint8Array(await r.arrayBuffer()); if (buf.length > 8_000_000) return null;
      let cs = (r.headers.get("content-type") ?? "").match(/charset=["']?([\w-]+)/i)?.[1];
      if (!cs) cs = new TextDecoder("latin1").decode(buf.slice(0, 6000)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
      let html: string; try { html = new TextDecoder(cs || "utf-8").decode(buf); } catch { html = new TextDecoder().decode(buf); }
      return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
    } catch { return null; }
  })());
  return pages.get(url)!;
}
// The Japanese name and the INCI name must both be on the page, within a short distance of each other.
function nearOnPage(page: string, ja: string, inci: string): boolean {
  const p = compact(page), j = compact(ja), c = compact(inci);
  if (!j || !c) return false;
  for (let at = p.indexOf(j); at >= 0; at = p.indexOf(j, at + 1)) {
    const win = p.slice(Math.max(0, at - 400), at + j.length + 400);
    if (win.includes(c)) return true;
  }
  return false;
}

const PROMPT = (targets: unknown) => `あなたは日本の化粧品の成分表示に詳しい薬事担当者です。次の各対象について、日本の化粧品の全成分表示に使う「成分表示名称」を、日本化粧品工業会（粧工連）の成分表示名称リストで調べてください。

手順と厳守事項:
- web_search で検索し、web_fetch で実際にページを開き、ページに書かれている成分表示名称を1文字も変えずに写す（全角・半角・記号もページのとおり）。
- 最優先は jcia.org の成分表示名称リスト。見つからなければ、INCI名と成分表示名称が同じページに並んで載っている信頼できる日本語の情報源。
- url には、その名称とINCI名の両方が実際に載っていたページのURLを書く（検索結果のURLではなく、開いて確認したページ）。
- ページで確認できなかった名称は ja に書かない。ja は空にし、最も可能性が高い名称を guess に入れ（推定であることを明示するため）、note に理由を日本語で書く。
- type が "row" の対象は INCI名が未記入。trade（商品名）・idName（インドネシアでの原料名）から、メーカーの資料などでINCI名を調べて inci に入れ（複数成分の混合原料なら " (and) " でつなぐ）、各成分の名称を components に入れる。INCI名を確認できなかった場合はその旨を note に書く。
- 日本の化粧品基準で配合禁止・配合制限がある成分は note にその旨を書く。
- 最後に次のJSONだけを出力する（説明文は不要）:
{"items":[{"key":"対象のkey","inci":"INCI名","components":[{"inci":"成分のINCI名","ja":"ページで確認した成分表示名称","url":"確認したページのURL","guess":""}],"note":""}]}

対象:
${JSON.stringify(targets)}`;

export async function labelNames(service: any, apiKey: string, rows: Row[]) {
  const client = new Anthropic({ apiKey });
  pages.clear(); // pages are read fresh for every request
  // Components of each row (rows without an INCI name are looked up as a whole).
  const rowComps = rows.map((r) => splitInci(String(r.inci ?? "").trim()));
  const byKey = new Map<string, string>();
  rowComps.flat().forEach((c) => byKey.set(normInci(c), c));
  const found = new Map<string, Comp>();
  const keys = [...byKey.keys()];
  if (keys.length) {
    const { data } = await service.from("label_names").select("inci_key, inci, ja, level, source_url").in("inci_key", keys);
    for (const d of data ?? []) found.set(d.inci_key, { inci: byKey.get(d.inci_key) ?? d.inci, ja: d.ja, level: d.level, url: d.source_url, note: "" });
  }
  const todo = keys.filter((k) => !found.has(k));
  const noInci = rows.filter((r, n) => !rowComps[n].length && (r.trade || r.idName));
  const inferred = new Map<number, { inci: string; comps: string[]; note: string }>();
  let searched = false, failed = "";

  if (todo.length || noInci.length) {
    const targets = [
      ...todo.map((k, n) => ({ key: "c" + n, type: "inci", inci: byKey.get(k) })),
      ...noInci.map((r) => ({ key: "r" + r.i, type: "row", trade: r.trade ?? "", idName: r.idName ?? "" })),
    ];
    let items: any[] = [];
    try { items = parseJSON(await claudeWeb(client, PROMPT(targets))).items ?? []; searched = true; }
    catch (e) { failed = String((e as any)?.message ?? e); }
    const checks: Promise<void>[] = [];
    for (const it of items) {
      const key = String(it?.key ?? "");
      const comps = Array.isArray(it?.components) ? it.components : [];
      const note = String(it?.note ?? "");
      if (key.startsWith("r")) inferred.set(+key.slice(1), { inci: String(it?.inci ?? ""), comps: comps.map((c: any) => String(c?.inci ?? "")).filter(Boolean), note });
      const want = key.startsWith("c") ? todo[+key.slice(1)] : null;
      for (const c of comps) {
        const inci = String(c?.inci ?? "").trim(), ja = String(c?.ja ?? "").trim(), url = String(c?.url ?? "").trim();
        const k = want && comps.length === 1 ? want : normInci(inci);
        if (!k || found.has(k)) continue; // already known, or being checked for another row
        const shown = byKey.get(k) ?? inci;
        const base: Comp = { inci: shown, ja: ja || String(c?.guess ?? "").trim(), level: "none", url, note: key.startsWith("c") ? note : "" };
        found.set(k, base);
        if (!ja || !/^https:\/\//i.test(url)) { base.note = ["AIの推定です（出典ページで確認できませんでした）", base.note].filter(Boolean).join("／"); continue; }
        checks.push(pageText(url).then(async (page) => {
          if (page && (nearOnPage(page, ja, shown) || nearOnPage(page, ja, inci))) {
            base.level = /(^|\.)jcia\.org$/i.test(new URL(url).hostname) ? "official" : "web";
            await service.from("label_names").upsert({ inci_key: k, inci: shown, ja, level: base.level, source_url: url, checked_at: new Date().toISOString() });
          } else {
            base.note = [base.note, page ? "出典ページに名称とINCI名が並んで見つかりませんでした" : "出典ページを自動で開けませんでした（リンク先を目で確認してください）"].filter(Boolean).join("／");
          }
        }));
      }
    }
    await Promise.all(checks);
  }
  if (!searched && failed && !found.size) throw new Error(failed);

  return rows.map((r, n) => {
    const inf = rowComps[n].length ? null : inferred.get(r.i);
    const names = rowComps[n].length ? rowComps[n] : inf?.comps.length ? inf.comps : inf?.inci ? splitInci(inf.inci) : [];
    const comps: Comp[] = names.map((c) => found.get(normInci(c)) ?? { inci: c, ja: "", level: "none", url: "", note: "調べられませんでした" });
    const levels = comps.map((c) => c.level);
    const level = !comps.length || levels.includes("none") ? "none" : levels.includes("web") ? "web" : levels.includes("manual") ? "manual" : "official";
    const notes = [
      ...(inf ? ["INCI名は未記入のため、AIが調べた推定です（要確認）" + (inf.note ? "：" + inf.note : "")] : []),
      ...comps.filter((c) => c.level === "none" || c.note).map((c) => (comps.length > 1 ? c.inci + "：" : "") + (c.note || "要確認")),
    ];
    return {
      i: r.i, inci: inf?.inci || "", mix: comps.length > 1,
      ja: comps.map((c) => c.ja).filter(Boolean).join("、"),
      level: inf ? "none" : level, sources: comps.map((c) => ({ inci: c.inci, ja: c.ja, level: c.level, url: c.url })),
      note: [...new Set(notes)].join("／"),
    };
  });
}
