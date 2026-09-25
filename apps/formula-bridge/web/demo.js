/* Demo mode: open the site with ?demo=admin or ?demo=supplier to walk through the screens
 * with sample data, without signing in. Nothing is sent to the server; edits last only for
 * this browser tab. The real app is unaffected when ?demo is absent.
 */
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has("demo")) return;
  const role = q.get("demo") === "supplier" ? "supplier" : "admin";
  const svgLogo = (bg, t) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='14' fill='${bg}'/><text x='50' y='62' font-family='Arial' font-weight='700' font-size='34' fill='#fff' text-anchor='middle'>${t}</text></svg>`);
  const DEMO_LOGOS = { "demo/logo-a.jpg": svgLogo("#1F6F5C", "BN"), "demo/logo-c.jpg": svgLogo("#8A3B8F", "SK") };
  const KEY = "fb-demo-db-v3";
  const now = Date.now(), ago = (h) => new Date(now - h * 3600e3).toISOString();

  const CA = "c-demo-a", CB = "c-demo-b", CC = "c-demo-c", P1 = "p-demo-1", ADMIN = "u-demo-admin", SUP = "u-demo-sup";
  const brief = {
    en: "FORMULA DEVELOPMENT REQUEST (DEMO)\n\nProduct category: Facial lotion (toner), 150 mL\nBenchmark: moisturizing lotion sold at Japanese drugstores\nTarget sensory profile: slightly viscous, absorbs quickly, non-sticky finish, fragrance-free\nKey ingredients: ceramide NP, niacinamide\nAvoid: parabens, mineral oil, ethanol\nTarget raw material cost: JPY 100 per unit / finished product: JPY 250 per unit\nTrial sample by: end of October 2026\n\nPlease submit in English: product features, formula (% w/w, INCI, Indonesian label name), raw material data and graphs, specifications/SDS/COA, sales materials, third-party test data.",
    id: "PERMINTAAN PENGEMBANGAN FORMULA (DEMO)\n\nKategori: Losion wajah (toner), 150 mL\nTekstur agak kental, cepat meresap, tidak lengket, tanpa pewangi.\nBahan utama: seramida NP, niasinamida.\nTarget biaya bahan: JPY 100 per botol.",
    ja: "（デモ）処方開発依頼書\n化粧水 150mL／ややとろみ・さっぱり・無香料／セラミドNP・ナイアシンアミド／原料費100円・完成品コスト250円／10月末に試作",
  };
  const snapshot = { name: "【デモ】セラミド保湿化粧水", brief: { en: brief.en, id: brief.id }, request: { costRaw: "100円", costFin: "250円", price: "1,980円", vol: "150mL", date: "2026年10月末" } };
  const F = (phase, idName, inci, pct, fn, ja) => ({ phase, trade: "", idName, inci, maker: "Demo", pct, fn, ja, jaNote: "" });
  const formula = [F("A", "Air", "Water", "83.7", "Solvent", "水"), F("A", "Butilen glikol", "Butylene Glycol", "6", "Humectant", "BG"), F("A", "Gliserin", "Glycerin", "4", "Humectant", "グリセリン"),
    F("A", "Niasinamida", "Niacinamide", "3", "Skin conditioning", "ナイアシンアミド"), F("A", "Pentilen glikol", "Pentylene Glycol", "2", "Humectant", "ペンチレングリコール"), F("A", "Karbomer", "Carbomer", "0.3", "Thickener", "カルボマー"),
    F("A", "Dinatrium EDTA", "Disodium EDTA", "0.05", "Chelating agent", "EDTA-2Na"), F("B", "Natrium hialuronat", "Sodium Hyaluronate", "0.1", "Humectant", "ヒアルロン酸Na"), F("B", "Seramida NP", "Ceramide NP", "0.05", "Skin conditioning", "セラミドNP"),
    F("C", "Kalium hidroksida", "Potassium Hydroxide", "0.3", "pH adjuster", "水酸化K"), F("C", "Fenoksietanol", "Phenoxyethanol", "0.5", "Preservative", "フェノキシエタノール")];
  const supplierA = {
    product: { name: "DEMO Ceramide Hydrating Lotion", concept: "Lightweight hydrating lotion with ceramide NP and niacinamide for daily barrier care.", features: "Slightly viscous gel-lotion, absorbs quickly\nFragrance-free, paraben-free, ethanol-free\nNiacinamide 3% and ceramide NP",
      claims: "Moisturizing (to be supported by third-party test)", appearance: "Clear, slightly viscous", ph: "5.5–6.5", viscosity: "2,000–4,000 mPa·s", shelfLife: "36 months", stability: "3 months at 4/25/45°C, no separation", cost: "JPY 92 / unit", moq: "25 kg per material", leadTime: "4 weeks", process: "Phase A dispersion → Phase B below 40°C → neutralize with Phase C" },
    formula, materials: [{ material: "Ceramide NP", feature: "Skin-identical ceramide supports the barrier", data: "Demo data — supplier study, n=20, 4 weeks" }],
    tests: [{ lab: "DEMO LAB (not real)", item: "Patch test", method: "48h occlusive, n=30", result: "No irritation (demo)", date: "2026-10-20" }], files: [],
  };
  const seed = {
    profiles: [{ id: ADMIN, role: "admin", company_id: null, email: "demo-admin@example.com", full_name: "（デモ）日本側 管理者" },
      { id: SUP, role: "supplier", company_id: CA, email: "demo-a@example.com", full_name: "Budi (demo)" }],
    companies: [
      { id: CA, name: "PT Demo Bahan Nusantara", contact_name: "Budi (demo)", contact_email: "demo-a@example.com", phone: "+62-21-000-0001", whatsapp: "+62-811-000-0001", address: "Jakarta", nib: "DEMO-0001", halal: "BPJPH certified (demo)", materials: "Ceramides, humectants", logo_path: "demo/logo-a.jpg", profile_completed_at: ago(200), nda_agreed_at: ago(200), created_at: ago(240) },
      { id: CB, name: "PT Demo Kimia Indah", contact_name: "Sari (demo)", contact_email: "demo-b@example.com", phone: "+62-21-000-0002", address: "Surabaya", nib: "DEMO-0002", halal: "In progress", materials: "Botanical extracts", nda_agreed_at: ago(190), created_at: ago(230) },
      { id: CC, name: "PT Demo Sumber Kosmetik", logo_path: "demo/logo-c.jpg", contact_name: "Andi (demo)", contact_email: "demo-c@example.com", phone: "+62-21-000-0003", address: "Bandung", nib: "DEMO-0003", halal: "BPJPH certified (demo)", materials: "Emulsifiers, preservatives", nda_agreed_at: ago(180), created_at: ago(220) } ],
    projects: [{ id: P1, name: "【デモ】セラミド保湿化粧水", request: { cat: "化粧水（ローション）", vol: "150mL", bench: "国内ドラッグストアの保湿化粧水", feel: "ややとろみ、なじむとさっぱり。無香料。", claim: "セラミドNP・ナイアシンアミド", avoid: "パラベン、鉱物油、エタノール", costRaw: "100円", costFin: "250円", price: "1,980円", date: "2026年10月末", markets: ["jp", "id"] }, brief, created_at: ago(170), updated_at: ago(2) }],
    assignments: [
      { id: "a-demo-a", project_id: P1, company_id: CA, status: "submitted", request_snapshot: snapshot, supplier: supplierA, requested_at: ago(168), submitted_at: ago(30), shipment: { carrier: "DHL", tracking: "DEMO1234567890", date: "2026-10-22", qty: "3 × 150 mL" }, shipped_at: ago(20), feedback: {}, feedback_at: null, updated_at: ago(20) },
      { id: "a-demo-b", project_id: P1, company_id: CB, status: "developing", request_snapshot: snapshot, supplier: { product: { name: "DEMO Lotion B" }, formula: [], materials: [], tests: [], files: [] }, requested_at: ago(168), shipment: {}, feedback: {}, updated_at: ago(40) },
      { id: "a-demo-c", project_id: P1, company_id: CC, status: "requested", request_snapshot: snapshot, supplier: {}, requested_at: ago(168), shipment: {}, feedback: {}, updated_at: ago(168) } ],
    finals: [{ project_id: P1, adopted_assignment: "a-demo-a", base_formula: formula.map((r) => (r.inci === "Water" ? { ...r, pct: "83.65" } : { ...r })),
      additions: [{ ja: "アセチルヒアルロン酸Na", inci: "Sodium Acetylated Hyaluronate", pct: "0.05", purpose: "保湿剤", note: "当社手配（デモ）" }],
      plan: { productName: "（デモ）セラミド保湿ローション", brand: "BIOT", target: "30〜40代・乾燥とハリ不足が気になる女性", price: "1,980円", cost: "240円", channel: "ドラッグストア・EC", launch: "2027年春", goal: "【要確認】", usp: "掛川の自社工場で製造するMade in Japan品質" },
      sup_ja: "（デモ）製品名：セラミド保湿ローション\nコンセプト：セラミドNPとナイアシンアミドを配合した、毎日のバリアケア向けの軽い保湿ローション。\n特徴：ややとろみのあるジェルローションで素早くなじむ／無香料・パラベンフリー・エタノールフリー\n原料見積：1本あたり92円（デモ）\n第三者試験：パッチテスト（デモ・実在しないデータ）",
      finalized_at: null, updated_at: ago(3) }],
    plans: [{ project_id: P1, created_at: ago(1), plan: { title: "（デモ）セラミド保湿ローション 新商品企画書", subtitle: "インドネシア原料メーカーとの共同開発・掛川工場で製造", date: "2026-09-25",
      slides: [["cover", "表紙", "案件：セラミド保湿化粧水／販売市場：日本・インドネシア", ["カテゴリ：化粧水 150mL", "作成日：2026-09-25"]],
        ["summary", "エグゼクティブサマリー", "セラミド×ナイアシンアミドの保湿化粧水を1,980円で2027年春に発売する。", ["原料はインドネシアから調達し、掛川工場で製造", "完成品コスト240円（目標250円以内）", "初年度販売目標は【要確認】"]],
        ["market_jp", "市場動向（日本）", "国内化粧品市場は拡大基調で、スキンケアが最大カテゴリー。", ["出典付きの調査データから作成（デモでは省略）"]],
        ["market_asia", "市場動向（インドネシア・アジア）", "インドネシアの化粧品市場は成長が続き、EC比率が上昇。", ["出典付きの調査データから作成（デモでは省略）"]],
        ["competitors", "競合分析", "ドラッグストアの保湿化粧水は大手と新興ブランドが競合。", ["価格帯1,500〜2,500円に競合が集中", "差別化軸：成分の見える化と国内製造"]],
        ["concept", "製品コンセプトとターゲット", "とろみがあるのにさっぱり、毎日のバリアケア。", ["ターゲット：30〜40代・乾燥とハリ不足", "無香料・パラベンフリー・エタノールフリー"]],
        ["formula", "処方と訴求成分", "セラミドNPとナイアシンアミドを訴求成分とする。", ["全成分は別表", "配合量は社外秘のため別紙"]],
        ["evidence", "エビデンス", "原料メーカーのデータと第三者試験で訴求を裏付ける。", ["パッチテスト（デモ・実在しないデータ）"]],
        ["business", "価格・販売チャネル・収益計画", "販売価格1,980円、完成品コスト240円。", ["チャネル：ドラッグストア・EC", "初年度販売目標：【要確認】"]],
        ["roadmap", "スケジュール・リスク・次のアクション", "10月末試作→評価→2027年春発売。", ["リスク：原料供給・為替・品質（COAで管理）", "次のアクション：試作評価とフィードバック"]]]
        .map(([key, title, lead, bullets]) => ({ key, title, lead, bullets, sources: [] })) } }],
    market: [], mail_log: [], admin_emails: [{ email: "demo-admin@example.com" }],
    settings: [{ key: "dev_email", value: "rd@instinct-bro.com" }, { key: "app_url", value: location.origin }],
    terms: [["nda", "Confidentiality Agreement (NDA)", "Perjanjian Kerahasiaan (NDA)", "秘密保持契約（NDA）"], ["purchase", "Declaration of Purchase by Artisans Production", "Pernyataan Pembelian oleh Artisans Production", "原料購入に関する当社宣言書"], ["ip", "Ownership of Adopted Formulas", "Kepemilikan Formula yang Diadopsi", "採用処方の帰属に関する合意"]]
      .map(([doc, en, idt, ja]) => ({ doc, version: "demo", current: true, title_en: en, title_id: idt, title_ja: ja, text_en: "(Demo) The full text is shown on the real registration page.", text_id: "(Demo) Teks lengkap ditampilkan di halaman pendaftaran.", text_ja: "（デモ）本番の登録画面には全文が表示されます。" })),
    agreement_log: ["nda", "purchase", "ip"].map((doc, i) => ({ id: i + 1, user_id: SUP, company_id: CA, doc, version: "demo", accepted_at: ago(200) })),
  };
  let db;
  try { db = JSON.parse(sessionStorage.getItem(KEY)) || seed; } catch { db = seed; }
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const me = role === "admin" ? ADMIN : SUP;
  const myCompany = role === "admin" ? null : CA;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let seq = 1000;

  // Mirror the database's access rules for the supplier view.
  function visible(table, rows) {
    if (role === "admin") return rows;
    if (table === "assignments") return rows.filter((r) => r.company_id === myCompany && r.status !== "draft");
    if (table === "companies") return rows.filter((r) => r.id === myCompany);
    if (table === "profiles") return rows.filter((r) => r.id === me);
    if (table === "agreement_log") return rows.filter((r) => r.user_id === me);
    if (table === "terms") return rows;
    return [];
  }
  function embed(table, cols, rows) {
    if (table !== "projects" || !/assignments\(/.test(cols || "")) return rows;
    return rows.map((p) => ({ ...p, assignments: db.assignments.filter((a) => a.project_id === p.id), finals: db.finals.filter((f) => f.project_id === p.id), plans: db.plans.filter((f) => f.project_id === p.id) }));
  }
  class Query {
    constructor(t) { this.t = t; this.op = "select"; this.filters = []; this.mode = "many"; }
    select(cols) { if (this.op === "select") this.cols = cols; this.returning = true; return this; }
    eq(k, v) { this.filters.push([k, v]); return this; }
    order(k, o = {}) { this.ord = [k, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.mode = "one"; return this; }
    maybeSingle() { this.mode = "one"; return this; }
    insert(rows) { this.op = "insert"; this.rows = [].concat(rows); return this; }
    update(patch) { this.op = "update"; this.patch = patch; return this; }
    upsert(rows, o = {}) { this.op = "upsert"; this.rows = [].concat(rows); this.conflict = o.onConflict; return this; }
    delete() { this.op = "delete"; return this; }
    run() {
      const table = (db[this.t] = db[this.t] || []);
      const match = (r) => this.filters.every(([k, v]) => r[k] === v);
      let out = [];
      if (this.op === "select") {
        out = visible(this.t, table).filter(match);
        if (this.ord) { const [k, asc] = this.ord; out = [...out].sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")) * (asc ? 1 : -1)); }
        if (this.lim) out = out.slice(0, this.lim);
        out = embed(this.t, this.cols, clone(out));
      } else if (role !== "admin" && !["assignments", "companies", "agreement_log"].includes(this.t)) {
        return { data: null, error: { message: "not allowed (demo)" } };
      } else if (this.op === "insert") {
        out = this.rows.map((r) => ({ id: r.id || `demo-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...clone(r) }));
        table.push(...out);
      } else if (this.op === "update") {
        out = visible(this.t, table).filter(match);
        out.forEach((r) => { Object.assign(r, clone(this.patch), { updated_at: new Date().toISOString() }); if (this.t === "assignments" && this.patch.status === "submitted" && !r.submitted_at) r.submitted_at = r.updated_at; });
        out = clone(out);
      } else if (this.op === "upsert") {
        const keys = this.conflict ? this.conflict.split(",") : this.t === "settings" ? ["key"] : this.t === "finals" || this.t === "plans" ? ["project_id"] : ["id"];
        out = this.rows.map((r) => {
          const hit = table.find((x) => keys.every((k) => x[k] === r[k]));
          if (hit) { Object.assign(hit, clone(r), { updated_at: new Date().toISOString() }); return clone(hit); }
          const row = { id: `demo-${++seq}`, created_at: new Date().toISOString(), ...clone(r) }; table.push(row); return clone(row);
        });
      } else if (this.op === "delete") {
        db[this.t] = table.filter((r) => !match(r));
      }
      if (this.op !== "select") persist();
      return { data: this.mode === "one" ? out[0] ?? null : out, error: null };
    }
    then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
  }
  const user = { id: me, email: db.profiles.find((p) => p.id === me)?.email };
  const client = {
    from: (t) => new Query(t),
    auth: {
      getSession: async () => ({ data: { session: { user } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { location.href = location.pathname + "?demo=" + role; },
      signInWithPassword: async () => ({ error: { message: "demo" } }),
      signUp: async () => ({ error: { message: "Registration is disabled in the demo." } }),
      resetPasswordForEmail: async () => ({ error: { message: "demo" } }),
      updateUser: async () => ({ error: { message: "demo" } }),
    },
    functions: {
      invoke: async (name, opts) => /Extract the cosmetic formula/.test(opts?.body?.prompt || "")
        ? { data: { text: JSON.stringify({ unit: "g", notes: "(Demo) Sample result — the real file is not read in the demo.", items: [
            { phase: "A", trade: "", idName: "Air", inci: "Water", maker: "", amt: "800", fn: "Solvent" },
            { phase: "A", trade: "Glycerin 99.5%", idName: "Gliserin", inci: "Glycerin", maker: "Demo Chem", amt: "50", fn: "Humectant" },
            { phase: "A", trade: "", idName: "Butilen glikol", inci: "Butylene Glycol", maker: "Demo Chem", amt: "60", fn: "Humectant" },
            { phase: "B", trade: "", idName: "Niasinamida", inci: "Niacinamide", maker: "Demo Chem", amt: "30", fn: "Skin conditioning" },
            { phase: "C", trade: "", idName: "Fenoksietanol", inci: "Phenoxyethanol", maker: "Demo Chem", amt: "5", fn: "Preservative" }] }) }, error: null }
        : name === "notify" || name === "invite"
        ? { data: { sent: false, reason: "demo" }, error: null }
        : { data: null, error: { context: { json: async () => ({ error: "demo" }) } } },
    },
    storage: { from: () => ({
      upload: async () => ({ error: { message: "Uploading is disabled in the demo." } }),
      remove: async () => ({ error: null }),
      createSignedUrl: async () => ({ error: { message: "demo" } }),
      createSignedUrls: async (paths) => ({ data: paths.map((x) => ({ path: x, signedUrl: DEMO_LOGOS[x] || null })), error: null }),
      download: async () => ({ error: { message: "demo" } }),
    }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  };

  window.FB_DEMO = { client, role };
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.className = "notice info";
    bar.style.margin = "12px 0 0";
    bar.innerHTML = `<b>デモ画面</b>（サンプルデータ。保存・メール送信・AI機能は動きません）
      <a href="?demo=admin#/">日本側（管理）画面を見る</a>　／　<a href="?demo=supplier#/">インドネシア側（PT Demo Bahan Nusantara）の画面を見る</a>　／
      <button class="linkbtn" id="demo-reset" type="button">サンプルを初期状態に戻す</button>`;
    document.querySelector(".wrap").prepend(bar);
    document.getElementById("demo-reset").onclick = () => { try { sessionStorage.removeItem(KEY); } catch {} location.reload(); };
  });
})();
