/* 処方ブリッジ Formula Bridge — hosted app (Supabase).
 * Roles: admin (Japan) sees everything; supplier (Indonesian company) sees only its own assignments.
 * Access is enforced by row level security; this file only decides what to show.
 */
(() => {
  "use strict";
  // An invitation link lands here with "type=invite" in the URL; the invited person then sets a password.
  const FROM_INVITE = /type=invite/.test(location.hash);
  const sb = window.FB_DEMO ? window.FB_DEMO.client : supabase.createClient(FB_CONFIG.supabaseUrl, FB_CONFIG.supabaseKey);
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  // Phones show tables as stacked cards; each cell carries its column name for that layout.
  const labelCells = () => app.querySelectorAll("table").forEach((t) => {
    const hs = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (td.colSpan === 1 && hs[i] && td.dataset.l !== hs[i]) td.dataset.l = hs[i]; }));
  });
  new MutationObserver(labelCells).observe(app, { childList: true, subtree: true });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : 0; };
  const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
  const today = () => new Date().toISOString().slice(0, 10);
  const dt = (s) => (s ? new Date(s).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const d = (s) => (s ? new Date(s).toLocaleDateString("ja-JP") : "—");
  const one = (x) => (Array.isArray(x) ? x[0] : x) || null;
  const FLAG_JP = '<i class="flag jp" role="img" aria-label="日本"></i>';
  const FLAG_ID = '<i class="flag id" role="img" aria-label="Indonesia"></i>';

  // Company logo: web/logo.png. If the file is missing, the BIOT wordmark is shown instead.
  const LOGO = `<img src="logo.png" alt="BIOT" class="logo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'logo-text',textContent:'BIOT'}))">`;
  document.querySelector(".topbar .brand").insertAdjacentHTML("afterbegin", LOGO);

  /* Agreements shown at registration (NDA, Artisans Production's purchase declaration, ownership of adopted formulas). */
  const DOC_ORDER = ["nda", "purchase", "ip"];
  async function loadTerms() {
    const { data } = await sb.from("terms").select("*").eq("current", true);
    return DOC_ORDER.map((k) => (data || []).find((t) => t.doc === k)).filter(Boolean);
  }
  function termsBlock(terms) {
    return terms.map((t, i) => `<div class="terms" data-doc="${esc(t.doc)}">
      <div class="head" style="margin-bottom:6px"><b>${i + 1}. ${esc(t.title_en)} / ${esc(t.title_id)}</b>
        <div class="seg"><button type="button" data-tl="en" aria-pressed="true">English</button><button type="button" data-tl="id" aria-pressed="false">Indonesia</button></div></div>
      <div class="terms-text" data-en="${esc(t.text_en)}" data-id="${esc(t.text_id)}">${esc(t.text_en)}</div>
      <label class="check" style="margin-top:8px"><input type="checkbox" data-agree="${esc(t.doc)}" data-ver="${esc(t.version)}" required>
        ${t.doc === "purchase" ? "I have read and acknowledge this declaration. / Saya telah membaca dan memahami pernyataan ini." : "I agree on behalf of my company. / Saya menyetujui atas nama perusahaan saya."} *</label>
      <div class="muted" style="font-size:11px">Version ${esc(t.version)}</div></div>`).join("");
  }
  function wireTerms(root) {
    root.querySelectorAll(".terms").forEach((box) => box.querySelectorAll("[data-tl]").forEach((b) => (b.onclick = () => {
      const txt = box.querySelector(".terms-text"); txt.textContent = txt.dataset[b.dataset.tl];
      box.querySelectorAll("[data-tl]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    })));
  }
  const agreedFrom = (root) => Object.fromEntries([...root.querySelectorAll("[data-agree]:checked")].map((c) => [c.dataset.agree, c.dataset.ver]));

  const S = { user: null, profile: null, company: null, isAdmin: false, companies: [], market: null };

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(title, body, kind = "ok") {
    $("toast-t").textContent = title; $("toast-b").textContent = body || "";
    $("toast").className = "toast" + (kind === "info" ? " info" : ""); $("toast").hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => ($("toast").hidden = true), 9000);
  }
  $("toast-x").onclick = () => ($("toast").hidden = true);

  async function copy(text, btn) {
    const old = btn.textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = "コピーしました / Copied"; }
    catch { btn.textContent = "コピーできませんでした"; }
    setTimeout(() => (btn.textContent = old), 1800);
  }
  function download(filename, blob) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const libs = { jspdf: "vendor/jspdf.umd.min.js", html2canvas: "vendor/html2canvas.min.js", XLSX: "vendor/xlsx.full.min.js", PptxGenJS: "vendor/pptxgen.bundle.js", docx: "vendor/docx.iife.js" };
  function lib(name) {
    if (window[name]) return Promise.resolve(window[name]);
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = libs[name]; s.onload = () => (window[name] ? res(window[name]) : rej(new Error(name))); s.onerror = rej; document.head.append(s); });
  }

  /* ---------------- AI (server-side Claude) ---------------- */
  const GLOSSARY = `化粧品開発の用語は次の訳語で統一すること:
処方=formula / formulasi, 試作=trial sample / sampel uji coba, 使用感=sensory profile / sensasi pemakaian, ベンチマーク品=benchmark product / produk acuan,
全成分=full ingredient list (INCI) / daftar bahan lengkap, 原料=raw material / bahan baku, 規格書=specification / spesifikasi, SDS, COA,
防腐剤=preservative / pengawet, 増粘剤=thickener / pengental, 保湿剤=humectant / humektan, 乳化剤=emulsifier / pengemulsi,
安定性試験=stability test / uji stabilitas, 防腐効力試験=challenge test, 原価=cost of goods / HPP, 最低発注量=MOQ, 納期=lead time,
化粧品基準=Japanese Standards for Cosmetics, 医薬部外品=quasi-drug, ハラール=halal, BPOM.`;
  const AI_ERR = { demo: "デモ画面ではAI機能（翻訳・変換・企画書作成）は動きません。", not_configured: "AIの設定（APIキー）がまだです。設定手順をご確認ください。", rate_limited: "混み合っています。1分ほど待ってからもう一度押してください。", refused: "この内容は処理できませんでした。表現を変えてお試しください。", unauthorized: "ログインし直してください。" };
  function parseJSON(text) {
    const t = String(text).trim();
    try { return JSON.parse(t); } catch {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
    const a = Math.min(...["{", "["].map((c) => (t.indexOf(c) + 1 || Infinity) - 1)), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (isFinite(a) && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    throw { userMsg: "結果の形式が崩れました。もう一度押してください。" };
  }
  // provider: "claude" (default) | "gemini" (Google Search research) | "openai" (review). aiRaw keeps the model name and web sources.
  async function aiRaw(prompt, { effort = "medium", image, document, images, documents, provider, search } = {}) {
    const { data, error } = await sb.functions.invoke("ai", { body: { prompt, effort, image, document, images, documents, provider, search } });
    if (error) {
      let code = ""; try { code = (await error.context.json()).error; } catch {}
      throw { userMsg: AI_ERR[code] || "通信が途切れました。もう一度押してください。", code };
    }
    return data;
  }
  async function ai(prompt, opts = {}) { return parseJSON((await aiRaw(prompt, opts)).text); }
  const blobB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function busy(btn, stEl, msg, fn) {
    if (btn.disabled) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = "処理中… / Working…";
    if (stEl) { stEl.className = "status"; stEl.textContent = msg; }
    try { await fn(); }
    catch (e) { if (stEl) { stEl.className = "status err"; stEl.textContent = e?.userMsg || e?.message || "エラーが発生しました / Something went wrong"; } console.error(e); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  /* ---------------- Auth ---------------- */
  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    S.user = session?.user || null;
    if (!S.user) { S.profile = null; S.isAdmin = false; return; }
    const { data: p } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
    S.profile = p; S.isAdmin = p?.role === "admin";
    S.company = null;
    if (p?.company_id) { const { data: c } = await sb.from("companies").select("*").eq("id", p.company_id).maybeSingle(); S.company = c; }
  }
  $("signout").onclick = async () => { await sb.auth.signOut(); location.hash = "#/login"; };
  sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") location.hash = "#/update-password"; });

  function viewLogin() {
    $("topbar").hidden = true;
    app.innerHTML = `<div class="auth card">
      <div style="margin-bottom:10px">${LOGO}</div>
      <h1>処方ブリッジ Formula Bridge</h1>
      <p class="lang-note">${FLAG_JP}${FLAG_ID} Sign in / Masuk / ログイン</p>
      <form id="f-login">
        <div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="l-pass">Password</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
        <div class="row"><button class="btn" type="submit">Sign in / ログイン</button><span class="spacer"></span><button class="linkbtn" type="button" id="to-reset">Forgot password?</button></div>
        <div class="status" id="st-login" role="status" aria-live="polite"></div>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <p class="sub" style="margin:0">${FLAG_ID} Supplier accounts are issued by Artisans Production. Please contact your representative in Japan.<br>Akun pemasok diterbitkan oleh Artisans Production. Silakan hubungi perwakilan Anda di Jepang.<br>仕入先のアカウントは当社が発行します。</p>
    </div>`;
    $("to-reset").onclick = () => (location.hash = "#/reset");
    $("f-login").onsubmit = async (e) => {
      e.preventDefault();
      const st = $("st-login"); st.className = "status"; st.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-pass").value });
      if (error) { st.className = "status err"; st.textContent = /confirm/i.test(error.message) ? "Please confirm your email first (check your inbox). / 確認メールのリンクを先に開いてください。" : "Email or password is incorrect. / メールアドレスかパスワードが違います。"; return; }
      await loadMe(); route(true);
    };
  }

  const REG_FIELDS = [
    ["company.name", "Company name / Nama perusahaan", true], ["full_name", "Your name / Nama Anda", true], ["title", "Job title / Jabatan"],
    ["email", "Email", true, "email"], ["password", "Password (min. 8 characters)", true, "password"], ["phone", "Phone / Telepon", true, "tel"],
    ["whatsapp", "WhatsApp", false, "tel"], ["company.address", "Company address / Alamat"], ["company.website", "Website"],
    ["company.nib", "Business ID (NIB)"], ["company.halal", "Halal certification (number or \"in progress\")"], ["company.materials", "Main raw materials you supply / Bahan baku utama"],
  ];
  function viewRegister() {
    $("topbar").hidden = true;
    app.innerHTML = `<div class="auth card en">
      <h1>${FLAG_ID} Supplier registration</h1>
      <p class="lang-note">${FLAG_JP} Artisans Production Co., Ltd. (Japan)</p>
      <p class="lang-note">Pendaftaran pemasok · 仕入先の企業登録. After registering, requests from Japan will appear on your page and be emailed to you.</p>
      <form id="f-reg">
        ${REG_FIELDS.map(([k, l, req, type]) => `<div class="field"><label for="g-${k}">${esc(l)}${req ? " *" : ""}</label>${k === "company.materials" || k === "company.address"
          ? `<textarea id="g-${k}"></textarea>` : `<input id="g-${k}" type="${type || "text"}" ${req ? "required" : ""} ${type === "password" ? 'minlength="8" autocomplete="new-password"' : ""}>`}</div>`).join("")}
        <h2 style="margin-top:16px">Agreements / Perjanjian</h2>
        <p class="sub">Please read all three and tick each box. Registration is not possible without them. / Harap baca ketiganya dan centang setiap kotak.</p>
        <div id="g-terms"><div class="hint">Loading…</div></div>
        <div class="row"><button class="btn saff" type="submit">Register / Daftar</button><a href="#/login" class="linkbtn">Back to sign in</a></div>
        <div class="status" id="st-reg" role="status" aria-live="polite"></div>
      </form></div>`;
    let terms = [];
    loadTerms().then((t) => { terms = t; $("g-terms").innerHTML = termsBlock(t) || '<div class="status err">Agreements could not be loaded. Please reload.</div>'; wireTerms($("g-terms")); });
    $("f-reg").onsubmit = async (e) => {
      e.preventDefault();
      const agreements = agreedFrom($("g-terms"));
      if (!terms.length || terms.some((t) => agreements[t.doc] !== t.version)) { $("st-reg").className = "status err"; $("st-reg").textContent = "Please agree to all three agreements. / Harap setujui ketiga perjanjian."; return; }
      const v = (k) => $("g-" + k).value.trim(), st = $("st-reg"), btn = e.submitter || $("f-reg").querySelector('button[type="submit"]');
      if (btn.disabled) return;
      btn.disabled = true; setTimeout(() => (btn.disabled = false), 60000);
      st.className = "status"; st.textContent = "Registering… / 登録しています…";
      const company = {}; REG_FIELDS.filter(([k]) => k.startsWith("company.")).forEach(([k]) => (company[k.slice(8)] = v(k)));
      const { data, error } = await sb.auth.signUp({
        email: v("email"), password: $("g-password").value,
        options: { emailRedirectTo: location.origin + location.pathname, data: { full_name: v("full_name"), title: v("title"), phone: v("phone"), whatsapp: v("whatsapp"), agreements, user_agent: navigator.userAgent, company } },
      });
      if (error) {
        st.className = "status err";
        st.textContent = /registered/i.test(error.message) ? "This email is already registered. Please sign in. / 登録済みです。ログインしてください。"
          : /seconds|rate/i.test(error.message) ? "Your registration may already have been received. Please check your email, or wait one minute and try again. / 登録は受け付け済みの可能性があります。メールを確認するか、1分後にもう一度お試しください。"
          : "Could not register: " + error.message;
        return;
      }
      if (!data.session) { st.className = "status"; st.innerHTML = "✓ Registered. We sent a confirmation email — please open the link in it, then sign in.<br>✓ Terdaftar. Silakan buka tautan di email konfirmasi, lalu masuk."; return; }
      toast("Registered ✓", "Welcome to Formula Bridge."); await loadMe(); location.hash = "#/"; route(true);
    };
  }
  function viewReset() {
    $("topbar").hidden = true;
    app.innerHTML = `<div class="auth card"><h1>Reset password / パスワード再設定</h1>
      <form id="f-reset"><div class="field"><label for="r-email">Email</label><input id="r-email" type="email" required></div>
      <div class="row"><button class="btn" type="submit">Send reset link</button><a href="#/login" class="linkbtn">Back</a></div>
      <div class="status" id="st-reset"></div></form></div>`;
    $("f-reset").onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.resetPasswordForEmail($("r-email").value.trim(), { redirectTo: location.origin + location.pathname + "#/update-password" });
      $("st-reset").textContent = error ? "Could not send: " + error.message : "If the address is registered, a reset link has been sent. / 登録済みなら再設定メールを送りました。";
    };
  }
  function viewUpdatePassword(inApp) {
    $("topbar").hidden = !inApp;
    app.innerHTML = `<div class="auth card"><h1>New password / 新しいパスワード</h1>
      <form id="f-up"><div class="field"><label for="u-pass">New password (min. 8)</label><input id="u-pass" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn" type="submit">Save</button><div class="status" id="st-up"></div></form></div>`;
    $("f-up").onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: $("u-pass").value });
      if (error) { $("st-up").className = "status err"; $("st-up").textContent = error.message; return; }
      toast("Password updated ✓", ""); location.hash = "#/";
    };
  }

  /* ---------------- Shared: formula tables ---------------- */
  const COLS = {
    formula: [
      { k: "phase", l: "Phase", w: 60, req: true }, { k: "trade", l: "Trade name", w: 150, req: true }, { k: "idName", l: "Nama bahan (Indonesian label name)", w: 190, req: true },
      { k: "inci", l: "INCI name", w: 190, req: true }, { k: "maker", l: "Supplier / maker", w: 130, req: true }, { k: "pct", l: "% w/w", w: 80, num: true, req: true },
      { k: "fn", l: "Function", w: 120, req: true }, { k: "ja", l: "日本語表示名称", ja: true, w: 170 },
      { k: "jaNote", l: "確認事項（AI）", jn: true, ro: true, w: 280 } ],
    materials: [{ k: "material", l: "Raw material", w: 180 }, { k: "feature", l: "Key feature", w: 280 }, { k: "data", l: "Supporting data (supplier / literature)", w: 360 }],
    tests: [{ k: "lab", l: "Laboratory", w: 160 }, { k: "item", l: "Test item", w: 170 }, { k: "method", l: "Method / n", w: 170 }, { k: "result", l: "Result", w: 260 }, { k: "date", l: "Date", w: 100 }],
    additions: [{ k: "ja", l: "日本語表示名称", w: 200 }, { k: "inci", l: "INCI", w: 200 }, { k: "pct", l: "配合量 %", w: 90, num: true }, { k: "purpose", l: "配合目的", w: 160 }, { k: "note", l: "備考（仕入先など）", w: 200 }],
  };
  const TPL_MARK = "Formula Bridge formula template v1";
  const TPL_HEAD = ["No.", "Phase", "Trade name", "Nama bahan (Indonesian label name)", "INCI name", "Supplier / maker", "Amount", "Function"];
  /* Formula as our Excel template (re-importable) — empty for the template, filled for exports. */
  async function formulaXlsx({ project, company, unit, rows }) {
    const XLSX = await lib("XLSX"), wb = XLSX.utils.book_new(), n = Math.max(40, rows.length), extra = rows.length ? ["% w/w", "日本語表示名称 (Japanese label name)", "確認事項（AI）"] : [];
    const head = TPL_HEAD.map((h) => h + (h === "No." ? "" : " *")).concat(extra);
    const cell = (v) => (v === "" || v == null ? "" : isNaN(Number(v)) ? String(v) : Number(v));
    const ws = XLSX.utils.aoa_to_sheet([[TPL_MARK], ["Fill in EVERY cell in English. Do not change the header row (row 7). / Isi SEMUA kolom dalam bahasa Inggris. Jangan ubah baris judul (baris 7)."],
      ["Project", project || ""], ["Company", company || ""], ["Amount unit (write %, g or mL) *", unit || "%"], [],
      head, ...Array.from({ length: n }, (_, i) => { const r = rows[i]; return r ? [i + 1, r.phase || "", r.trade || "", r.idName || "", r.inci || "", r.maker || "", cell(unit === "%" ? r.pct : r.amt), r.fn || "", cell(r.pct), r.ja || "", r.jaNote || ""] : [i + 1, "", "", "", "", "", "", ""]; }),
      ["", "", "", "", "", "Total", { f: `SUM(G8:G${7 + n})` }, "", ...(rows.length ? [{ f: `SUM(I8:I${7 + n})` }] : [])]]);
    ws["!cols"] = [8, 10, 24, 30, 30, 22, 12, 22, 10, 28, 40].map((w) => ({ wch: w }));
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Formula");
    const ex = XLSX.utils.aoa_to_sheet([["EXAMPLE — do not fill in this sheet / CONTOH"], [], TPL_HEAD,
      [1, "A", "Purified water", "Air", "Water", "—", 83.7, "Solvent"], [2, "A", "Glycerin 99.5%", "Gliserin", "Glycerin", "Wilmar", 4, "Humectant"],
      [3, "B", "Ceramide NP-3", "Seramida NP", "Ceramide NP", "Evonik", 0.05, "Skin conditioning"], [4, "C", "Euxyl PE 9010", "Fenoksietanol, Etilheksilgliserin", "Phenoxyethanol, Ethylhexylglycerin", "Schülke", 0.5, "Preservative"]]);
    ex["!cols"] = [8, 10, 24, 30, 30, 22, 12, 22].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ex, "Example");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["How to fill in / Cara mengisi"], [],
      ["1", "One row per raw material, in the order you add them. / Satu baris per bahan baku."], ["2", "Phase: A, B, C … (the manufacturing phase). / Fase pembuatan."],
      ["3", "Trade name: the product name of the raw material. / Nama dagang bahan baku."], ["4", "Nama bahan: the Indonesian label name. / Nama bahan sesuai label Indonesia."],
      ["5", "INCI name: the international name. For a blend, list all INCI names separated by commas. / Untuk campuran, tulis semua nama INCI."],
      ["6", "Supplier / maker: who makes the raw material. / Produsen bahan baku."], ["7", "Amount: numbers only, in the unit written in cell B5 (%, g or mL). If %, the total must be 100. / Hanya angka. Jika %, total harus 100."],
      ["8", "Function: e.g. Humectant, Emulsifier, Preservative. / Fungsi bahan."], ["9", "Save the file and drop it into Formula Bridge (section B). / Simpan lalu unggah ke Formula Bridge (bagian B)."]]), "How to fill");
    return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const fileBase = (name, kind) => `FormulaBridge_${kind}_` + String(name || "request").replace(/[\\/:*?"<>|\s]+/g, "_");
  /* Formula as an A4 landscape PDF (rendered from HTML so Japanese names print correctly). */
  async function formulaPdf({ project, company, logo, unit, rows, requester }) {
    const [{ jsPDF }, h2c] = await Promise.all([lib("jspdf"), lib("html2canvas")]);
    let logoData = "";
    if (logo) try { const b = await (await fetch(logo)).blob(); logoData = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); }); } catch { /* print without the logo */ }
    const per = 14, pages = Math.max(1, Math.ceil(rows.length / per)), tot = rows.reduce((a, r) => a + num(unit === "%" ? r.pct : r.amt), 0);
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-99999px;top:0"; document.body.append(host);
    try {
      for (let pg = 0; pg < pages; pg++) {
        const part = rows.slice(pg * per, pg * per + per);
        host.innerHTML = `<div class="pdf-page"><div class="pdf-head">${logoData ? `<img src="${logoData}" alt="">` : ""}<div><div class="pdf-t">Formula / 処方表</div><div class="pdf-m">Project: <b>${esc(project || "")}</b>　Company: <b>${esc(company || "")}</b>${requester ? `　Requested by: ${esc(requester)}` : ""}</div>
          <div class="pdf-m">Unit: ${unit === "%" ? "% w/w" : esc(unit) + " per batch (% calculated)"}　Date: ${new Date().toISOString().slice(0, 10)}　Page ${pg + 1}/${pages}</div></div><div class="pdf-brand">Formula Bridge<br><span>Artisans Production Co., Ltd.</span></div></div>
          <table class="pdf-tbl"><thead><tr><th>No.</th><th>Phase</th><th>Trade name</th><th>Nama bahan</th><th>INCI name</th><th>Supplier</th>${unit === "%" ? "" : `<th>Amount (${esc(unit)})</th>`}<th>% w/w</th><th>Function</th><th>日本語表示名称</th></tr></thead><tbody>
          ${part.map((r, i) => `<tr><td>${pg * per + i + 1}</td><td>${esc(r.phase || "")}</td><td>${esc(r.trade || "")}</td><td>${esc(r.idName || "")}</td><td>${esc(r.inci || "")}</td><td>${esc(r.maker || "")}</td>${unit === "%" ? "" : `<td class="n">${esc(r.amt || "")}</td>`}<td class="n">${esc(r.pct || "")}</td><td>${esc(r.fn || "")}</td><td>${esc(r.ja || "")}</td></tr>`).join("")}
          ${pg === pages - 1 ? `<tr class="tot"><td colspan="6" style="text-align:right">Total</td>${unit === "%" ? "" : `<td class="n">${fmt(tot)}</td>`}<td class="n">${fmt(rows.reduce((a, r) => a + num(r.pct), 0))}</td><td colspan="2"></td></tr>` : ""}</tbody></table>
          <div class="pdf-foot">Confidential — Formula Bridge / Artisans Production Co., Ltd.</div></div>`;
        const cv = await h2c(host.firstElementChild, { scale: 2, backgroundColor: "#ffffff", logging: false });
        if (pg) pdf.addPage();
        pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 297, 210);
      }
    } finally { host.remove(); }
    return pdf.output("blob");
  }

  /* An editable table bound to an array; onChange is called after every edit. */
  function editTable(el, cols, rows, onChange, { totalCheck = false, readOnly = false } = {}) {
    const boxed = readOnly && el.classList.contains("mirror");
    const render = () => {
      if (el.contains(document.activeElement)) return;
      const tk = cols.find((c) => c.total)?.k || "pct";
      const tot = rows.reduce((a, r) => a + num(r[tk]), 0), pi = cols.findIndex((c) => c.k === tk);
      el.innerHTML = `<thead><tr><th>No.</th>${cols.map((c) => `<th class="${c.ja ? "ja-col" : ""}" style="min-width:${c.w}px">${esc(c.l)}</th>`).join("")}${readOnly ? "" : "<th></th>"}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td class="no">${i + 1}</td>${cols.map((c) => c.ja || c.ro || readOnly
          ? `<td class="${c.ja ? "ja" : c.jn ? "jnote" : c.num ? "num" : ""}" style="padding:8px">${boxed && !c.ja && !c.jn ? `<span class="cellbox">${esc(r[c.k] ?? "")}</span>` : esc(r[c.k] ?? "")}</td>`
          : `<td class="${c.num ? "num" : ""}"><input data-i="${i}" data-k="${c.k}" value="${esc(r[c.k] ?? "")}" class="${c.req && !String(r[c.k] ?? "").trim() ? "miss" : ""}" aria-label="${esc(c.l)} ${i + 1}" ${c.ph ? `placeholder="${esc(c.ph)}"` : ""} ${c.num ? 'inputmode="decimal"' : ""}></td>`).join("")}
          ${readOnly ? "" : `<td><button class="x" data-del="${i}" aria-label="Delete row">×</button></td>`}</tr>`).join("") || `<tr><td colspan="${cols.length + 2}" class="hint" style="padding:12px">No rows yet / まだ行がありません</td></tr>`}</tbody>
        ${pi >= 0 ? `<tfoot><tr><td colspan="${pi + 1}" style="text-align:right">Total</td><td class="num ${totalCheck && tk === "pct" ? (Math.abs(tot - 100) < 0.001 ? "total-ok" : "total-bad") : ""}">${fmt(tot)}</td><td colspan="${cols.length - pi + (readOnly ? -1 : 0)}"></td></tr></tfoot>` : ""}`;
    };
    el.oninput = (e) => {
      const t = e.target; if (!t.dataset.k) return; const r = rows[+t.dataset.i]; if (!r) return;
      r[t.dataset.k] = t.value;
      if (cols.find((c) => c.k === t.dataset.k)?.req) t.classList.toggle("miss", !t.value.trim());
      if (["idName", "inci", "trade"].includes(t.dataset.k) && "ja" in r && cols.some((c) => c.ja)) { r.ja = ""; r.jaNote = ""; }
      const tk = cols.find((c) => c.total)?.k || "pct";
      onChange();
      if (t.dataset.k === tk) { const c = el.querySelector("tfoot td.num"); if (c) { const tot = rows.reduce((a, x) => a + num(x[tk]), 0); c.textContent = fmt(tot); if (totalCheck && tk === "pct") c.className = "num " + (Math.abs(tot - 100) < 0.001 ? "total-ok" : "total-bad"); } }
    };
    el.onclick = (e) => { const b = e.target.closest("[data-del]"); if (b) { rows.splice(+b.dataset.del, 1); onChange(); render(); } };
    el.addEventListener("focusout", () => setTimeout(render, 0));
    render();
    return { render, add() { rows.push({}); onChange(); render(); el.querySelector("tbody tr:last-child input")?.focus(); } };
  }

  /* Debounced save helper: one write at a time. */
  function saver(fn, st) {
    let t, chain = Promise.resolve(), pending = false;
    const run = () => { pending = false; chain = chain.then(fn).then(() => { if (st) st.textContent = "Saved / 保存しました " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }); },
      (e) => { if (st) st.textContent = "Could not save / 保存できませんでした"; console.error(e); }); return chain; };
    return { soon() { pending = true; if (st) st.textContent = "Saving… / 保存待ち…"; clearTimeout(t); t = setTimeout(run, 1000); }, now() { clearTimeout(t); return pending ? run() : chain; } };
  }

  /* Indonesian / trade names → Japanese label names (日本語表示名称) */
  async function convertToJapanese(rows) {
    const list = rows.map((r, i) => ({ i, trade: r.trade || "", idName: r.idName || "", inci: r.inci || "" })).filter((r) => r.trade || r.idName || r.inci);
    if (!list.length) throw { userMsg: "Enter at least one ingredient. / 原料を1行以上入力してください。" };
    const res = await ai(`あなたは日本とインドネシア（BPOM）の化粧品規制に詳しい処方技術者です。
次はインドネシアの原料メーカーが入力した処方の原料リストです（trade=商品名, idName=インドネシアでの原料表示名称, inci=INCI名。空欄あり）。
各行について、日本の化粧品の全成分表示で使う「日本語表示名称」（日本化粧品工業会の表示名称リストに準拠）を答えてください。
- 1つの原料が複数成分の混合物なら、含まれる成分の日本語表示名称を「、」で区切って並べ、mix=true。
- 確信が持てない場合は推測で断定せず、note に「要確認: 理由」を日本語で書く。日本の化粧品基準で配合制限・禁止がある成分も note に書く。
- inci が空なら推定したINCI名を inci に入れ、推定である旨を note に書く。
JSONのみで返答: {"items":[{"i":0,"ja":"","inci":"","mix":false,"note":""}]}

${JSON.stringify(list)}`, { effort: "medium" });
    let n = 0;
    (res.items || []).forEach((x) => { const r = rows[+x.i]; if (!r) return; r.ja = String(x.ja || ""); r.mix = !!x.mix; r.jaNote = String(x.note || ""); if (!r.inci && x.inci) r.inci = String(x.inci); n++; });
    return n;
  }

  const UNIT_FIELDS = {
    viscosity: ["mPa·s", "cP", "Pa·s"], shelfLife: ["months", "years"],
    cost: ["IDR / unit", "JPY / unit", "USD / unit", "IDR / kg", "JPY / kg", "USD / kg"],
    moq: ["kg", "g", "L", "mL", "pcs"], leadTime: ["days", "weeks", "months"],
  };
  const PRODUCT_PH = {
    name: "e.g. Ceramide Hydrating Lotion", concept: "Who it is for and what it does, in 1–3 sentences",
    features: "One feature per line\ne.g. Fragrance-free\ne.g. Absorbs quickly", claims: "e.g. Moisturizing for 24 hours (supported by test)",
    appearance: "e.g. Clear, slightly viscous liquid", ph: "e.g. 5.5–6.5", viscosity: "e.g. 3000", shelfLife: "e.g. 36",
    stability: "e.g. 3 months at 4/25/45°C, no separation", cost: "e.g. 15000", moq: "e.g. 25", leadTime: "e.g. 4",
    process: "Main steps and temperatures, e.g. Phase A at 75°C → cool → add Phase B below 40°C",
  };
  const PRODUCT_FIELDS = [["name", "Product name"], ["concept", "Concept"], ["features", "Key features (one per line)"], ["claims", "Possible marketing claims"], ["appearance", "Appearance / texture"], ["ph", "pH"], ["viscosity", "Viscosity"], ["shelfLife", "Shelf life"], ["stability", "Stability test summary"], ["cost", "Your quote: raw material cost per unit"], ["moq", "MOQ"], ["leadTime", "Lead time"], ["process", "Manufacturing process"]];
  function supplierEnglish(sp) {
    const p = sp.product || {};
    const lines = PRODUCT_FIELDS.filter(([k]) => p[k]).map(([k, l]) => `${l}: ${p[k]}`);
    if ((sp.materials || []).length) lines.push("Raw material highlights:\n" + sp.materials.map((m) => `- ${m.material}: ${m.feature} / Data: ${m.data || "-"}`).join("\n"));
    if ((sp.tests || []).length) lines.push("Third-party tests:\n" + sp.tests.map((t) => `- ${t.lab} | ${t.item} | ${t.method || "-"} | ${t.result} | ${t.date || "-"}`).join("\n"));
    if ((sp.files || []).length) lines.push("Attachments:\n" + sp.files.map((f) => `- [${f.cat}] ${f.name}${f.desc ? " — " + f.desc : ""}`).join("\n"));
    return lines.join("\n");
  }
  async function openFile(path) {
    const { data, error } = await sb.storage.from("attachments").createSignedUrl(path, 600);
    if (error) { toast("Could not open file", error.message, "info"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  /* ================= SUPPLIER (Indonesia) ================= */
  async function supplierHome() {
    const { data: rows, error } = await sb.from("assignments").select("id, status, request_snapshot, requested_at, submitted_at, shipped_at, feedback_at, updated_at").order("requested_at", { ascending: false });
    app.innerHTML = `${S.company && !S.company.logo_path ? `<div class="notice off en"><b>Please upload your company logo (JPG).</b> Japan uses it to tell suppliers apart. / Harap unggah logo perusahaan Anda (JPG). <a href="#/company">Company profile →</a></div>` : ""}<div class="who id">${FLAG_ID}${esc(S.company?.name || "")} — requests from Japan<small>Permintaan dari Jepang · Only your company can see these.</small></div>
      <div class="card en"><h2>Requests / Permintaan</h2>
      ${error ? `<p class="status err">${esc(error.message)}</p>` : (rows || []).length ? `<div class="tbl-wrap"><table class="view master"><thead><tr><th>Project</th><th>Received</th><th>Status</th><th>Submitted</th><th>Sample shipped</th><th>Feedback from Japan</th><th></th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td>${esc(a.request_snapshot?.name || "(project)")}</td><td>${d(a.requested_at)}</td><td>${chip(a.status, true)}</td><td>${d(a.submitted_at)}</td><td>${a.shipped_at ? '<span class="chip done">Shipped ✓</span>' : "—"}</td><td>${a.feedback_at ? '<span class="chip done">Received ✓</span>' : "—"}</td><td><a href="#/a/${a.id}">Open / Buka →</a></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No requests yet. You will receive an email when Japan sends one.<br>Belum ada permintaan.</div>`}
      </div>`;
  }

  function chip(status, en) {
    const L = { draft: ["下書き", "Draft"], requested: ["依頼済み", "New request"], developing: ["開発中", "In progress"], submitted: ["提出済み ✓", "Submitted ✓"] }[status] || [status, status];
    return `<span class="chip ${esc(status)}">${esc(en ? L[1] : L[0])}</span>`;
  }

  async function supplierAssignment(aid) {
    const { data: a, error } = await sb.from("assignments").select("*").eq("id", aid).maybeSingle();
    if (error || !a) { app.innerHTML = `<div class="card"><p>This request was not found, or it is not addressed to your company.</p><a href="#/">← Back</a></div>`; return; }
    const sp = Object.assign({ product: {}, formula: [], materials: [], tests: [], files: [] }, a.supplier || {});
    const snap = a.request_snapshot || {}, rq = snap.request || {};
    await loadLogos([S.company]);
    app.innerHTML = `<div class="who id ${a.status === "submitted" ? "is-done" : ""}">${FLAG_ID}Your company fills in this page · Diisi oleh tim Indonesia<small>Please write in English</small><span class="state">${a.status === "submitted" ? "Done ✓" : "In progress"}</span></div>
    <div class="stack en">
      ${a.feedback_at ? `<div class="card" style="border-color:var(--ok)"><h2>${FLAG_JP}Feedback from Japan / Umpan balik dari Jepang</h2>
        <p class="sub">${dt(a.feedback_at)} · <b>${esc(a.feedback?.decision_en || "")}</b></p>
        <div class="brief-out">${esc(a.feedback?.en || "")}</div><div class="brief-out" style="margin-top:8px">${esc(a.feedback?.id || "")}</div></div>` : ""}
      <div class="card"><div class="head"><div><h2>${FLAG_JP}Request from Japan: ${esc(snap.name || "")}</h2>${rq.requester ? `<p class="sub" style="margin:0">Requested by / Diminta oleh: <b>${esc(rq.requester)}</b> (Artisans Production Co., Ltd.)</p>` : ""}</div>
        <div class="seg"><button type="button" data-rq="en" aria-pressed="true">English</button><button type="button" data-rq="id" aria-pressed="false">Bahasa Indonesia</button></div></div>
        <div class="brief-out" id="dev-brief"></div></div>
      <div class="card"><h2>${FLAG_ID}A. Product overview</h2><p class="sub">Changes are saved automatically. <span class="saved" id="saved"></span></p>
        <div class="targets"><div><span>${FLAG_JP}TARGET RAW MATERIAL COST / UNIT</span><b>${esc(rq.costRaw || "—")}</b></div><div><span>${FLAG_JP}TARGET FINISHED PRODUCT COST / UNIT</span><b>${esc(rq.costFin || "—")}</b></div><div><span>${FLAG_JP}PLANNED RETAIL PRICE</span><b>${esc(rq.price || "—")}</b></div></div>
        <div id="prod-fields"></div></div>
      <div class="card"><div class="head"><div><h2>${FLAG_ID}B. Base formula</h2><p class="sub" style="margin:0">One row per raw material. Enter the Indonesian label name (Nama bahan) and the amount. The Japanese name is filled in by the button.</p></div>
        <div class="to-ja-wrap"><span class="next-tag" id="to-ja-tag" hidden>▶ Next step / Langkah berikutnya</span><button class="btn ghost" id="to-ja">Convert to Japanese names / 日本語表示名称に変換</button></div></div>
        <div class="tpl-box"><div><b>① Download our formula template (Excel), fill in every cell, then ② drop it in the box below.</b>
          <span>Unduh template formula kami (Excel), isi semua kolom, lalu letakkan di kotak di bawah. A PDF in your lab's own format is also OK — any empty cells must then be filled in here.</span></div>
          <button type="button" class="btn saff" id="tpl-dl">⬇ Formula template (Excel)</button></div>
        <div class="drop" id="f-drop" tabindex="0" role="button" aria-label="Import formula from a file">
          <b>⬇ Drop your formula file here, or tap to choose</b>
          <span>PDF, Excel (.xlsx / .xls), CSV or a photo — the table below is filled in automatically.</span>
          <span>Letakkan file formula di sini (PDF, Excel, CSV, foto). ／ 成分表ファイルをここにドロップすると自動で入力されます。</span>
          <input type="file" id="f-drop-in" accept=".pdf,.xlsx,.xls,.csv,image/jpeg,image/png,image/webp" hidden></div>
        <div class="status" id="st-drop" role="status" aria-live="polite"></div><div id="drop-preview"></div>
        <div class="field" style="max-width:340px"><label for="f-unit">Amount unit / Satuan jumlah</label><select id="f-unit"><option value="%">% w/w (total 100%)</option><option value="g">g per batch (% is calculated)</option><option value="mL">mL per batch (% is calculated)</option></select></div>
        <div class="tbl-wrap"><table class="edit" id="t-formula"></table></div>
        <div class="status err" id="st-miss" role="status"></div>
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="add-formula">＋ Add row</button><span class="spacer"></span>
          <span class="muted" style="font-size:12.5px">Save the formula as / Simpan sebagai:</span><button type="button" class="btn ghost" id="f-xlsx">⬇ Excel</button><button type="button" class="btn ghost" id="f-pdf">⬇ PDF</button></div>
        <p class="sub" style="margin:6px 0 0">When you submit, the formula is also sent to Japan as Excel and PDF automatically. / Saat dikirim, formula juga dikirim ke Jepang dalam Excel dan PDF.</p>
        <div class="status" id="st-toja"></div></div>
      <div class="card"><h2>${FLAG_ID}C. Raw material highlights</h2><p class="sub">Features of key raw materials and your data (efficacy, mechanism, dosage). Attach graphs in section E.</p>
        <div class="tbl-wrap"><table class="edit" id="t-materials"></table></div><div class="row" style="margin-top:8px"><button class="btn ghost" id="add-materials">＋ Add row</button></div></div>
      <div class="card"><h2>${FLAG_ID}D. Third-party test data</h2><p class="sub">Tests by independent laboratories (patch test, efficacy, stability, microbiology…). Attach reports in section E.</p>
        <div class="tbl-wrap"><table class="edit" id="t-tests"></table></div><div class="row" style="margin-top:8px"><button class="btn ghost" id="add-tests">＋ Add row</button></div></div>
      <div class="card"><h2>${FLAG_ID}E. Attachments</h2><p class="sub">Data sheets, graphs, specifications, sales materials, third-party reports, SDS, COA (max 25 MB each).</p>
        <div class="files" id="files"></div>
        <div class="upl"><div class="field" style="margin:0"><label for="f-cat">Category</label><select id="f-cat"><option>Raw material data</option><option>Graph / chart</option><option>Specification</option><option>Sales material</option><option>Third-party report</option><option>SDS</option><option>COA</option><option>Other</option></select></div>
          <div class="field" style="margin:0"><label for="f-desc">Description</label><input id="f-desc" placeholder="e.g. Hydration graph, 4 weeks, n=20"></div>
          <label class="btn saff" style="position:relative">Upload file<input type="file" id="f-file" multiple style="position:absolute;width:1px;height:1px;opacity:0"></label></div>
        <div class="status" id="st-upl"></div></div>
      <div class="card"><h2>${FLAG_ID}Submit to Japan</h2><p class="sub">When the sample is ready and A–E are complete, press Submit. Japan's development team is notified by email.</p>
        <div class="row"><button class="btn saff big" id="submit">Submit to Japan</button><span class="spacer"></span>
          </div>
        <div class="status" id="st-submit"></div></div>
      <div class="card" id="ship-card"><h2>${FLAG_ID}F. Sample shipment to Japan / Pengiriman sampel</h2>
        <p class="sub">After submitting, send the sample to Japan and enter the tracking number. Press "Shipment complete" — Japan's development team is emailed automatically.</p>
        <div class="grid2">
          <div class="field"><label for="s-carrier">Courier / Kurir</label><select id="s-carrier"><option></option><option>DHL</option><option>FedEx</option><option>UPS</option><option>EMS (Pos Indonesia)</option><option>JNE</option><option>Other</option></select></div>
          <div class="field"><label for="s-tracking">Tracking number / Nomor resi *</label><input id="s-tracking"></div>
          <div class="field"><label for="s-date">Ship date / Tanggal kirim</label><input id="s-date" type="date"></div>
          <div class="field"><label for="s-qty">Samples / Jumlah sampel</label><div class="num-unit"><input id="s-qty" inputmode="decimal" placeholder="e.g. 3"><select id="s-qtyu" aria-label="unit"><option>pcs</option><option>bottles</option><option>mL</option><option>g</option><option>kg</option><option>L</option></select></div></div>
        </div>
        <div class="field"><label for="s-note">Note / Catatan</label><input id="s-note"></div>
        <div class="row"><button class="btn saff big" id="ship">Shipment complete / Pengiriman selesai</button></div>
        <div class="status" id="st-ship"></div></div>
    </div>`;
    let lang = "en";
    const renderBrief = () => { $("dev-brief").textContent = (snap.brief || {})[lang] || "—"; document.querySelectorAll("[data-rq]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rq === lang))); };
    document.querySelectorAll("[data-rq]").forEach((b) => (b.onclick = () => { lang = b.dataset.rq; renderBrief(); }));
    renderBrief();

    let status = a.status;
    const save = saver(async () => {
      const patch = { supplier: sp };
      if (status === "requested") patch.status = "developing";
      const { error } = await sb.from("assignments").update(patch).eq("id", aid);
      if (error) throw error;
      if (patch.status) status = patch.status;
    }, $("saved"));

    // Fields with a number and a unit keep both parts (productParts) and a readable text (product[k]).
    sp.productParts = sp.productParts || {};
    $("prod-fields").innerHTML = `<p class="req-note">* Required / Wajib diisi</p><div class="grid2">` + PRODUCT_FIELDS.map(([k, l]) => {
      const u = UNIT_FIELDS[k], ph = PRODUCT_PH[k] || "", req = k === "name" ? " *" : "";
      const wide = ["concept", "features", "claims", "stability", "process"].includes(k);
      const ctl = wide ? `<textarea id="p-${k}" placeholder="${esc(ph)}"></textarea>`
        : u ? `<div class="num-unit"><input id="p-${k}" inputmode="decimal" placeholder="${esc(ph)}"><select id="pu-${k}" aria-label="unit">${u.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div>`
        : `<input id="p-${k}" placeholder="${esc(ph)}">`;
      return `<div class="field ${wide ? "span2" : ""}"><label for="p-${k}">${esc(l)}${req}</label>${ctl}</div>`;
    }).join("") + `</div>`;
    PRODUCT_FIELDS.forEach(([k]) => {
      const el = $("p-" + k), sel = $("pu-" + k), part = sp.productParts[k];
      if (sel) {
        if (part) { el.value = part.v || ""; sel.value = part.u || sel.value; }
        else if (sp.product[k]) { const m = String(sp.product[k]).match(/^\s*([\d.,]+)\s*(.*)$/); el.value = m ? m[1] : sp.product[k]; if (m && [...sel.options].some((o) => o.value === m[2])) sel.value = m[2]; }
        const upd = () => { sp.productParts[k] = { v: el.value.trim(), u: sel.value }; sp.product[k] = el.value.trim() ? `${el.value.trim()} ${sel.value}` : ""; save.soon(); };
        el.oninput = upd; sel.onchange = upd;
      } else { el.value = sp.product[k] || ""; el.oninput = () => { sp.product[k] = el.value; save.soon(); }; }
    });

    // Formula amounts: % w/w (default) or g / mL per batch; % is then worked out automatically.
    sp.formulaUnit = sp.formulaUnit || "%";
    const formulaCols = () => sp.formulaUnit === "%" ? COLS.formula.map((c) => (c.k === "pct" ? { ...c, ph: "e.g. 2.5" } : c))
      : COLS.formula.flatMap((c) => c.k === "pct" ? [{ k: "amt", l: `Amount (${sp.formulaUnit}) / batch`, w: 110, num: true, total: true, req: true, ph: "e.g. 25" }, { k: "pct", l: "% w/w (auto)", w: 90, num: true, ro: true }] : [c]);
    const recalcPct = () => {
      if (sp.formulaUnit === "%") return;
      const tot = sp.formula.reduce((a, r) => a + num(r.amt), 0);
      sp.formula.forEach((r) => (r.pct = tot ? String(Math.round((num(r.amt) / tot) * 100000) / 1000) : ""));
    };
    let tF;
    // Empty required cells (highlighted) and the "convert to Japanese names" next-step cue.
    const blanks = () => { const cols = formulaCols().filter((c) => c.req); return sp.formula.map((r, i) => ({ i, m: cols.filter((c) => !String(r[c.k] ?? "").trim()).map((c) => c.l) })).filter((x) => x.m.length); };
    const needsJa = () => sp.formula.some((r) => (r.trade || r.idName || r.inci) && !r.ja);
    const refreshCues = () => {
      const b = blanks(), n = b.reduce((a, x) => a + x.m.length, 0);
      $("st-miss").textContent = n ? `⚠ ${n} empty cell${n > 1 ? "s" : ""} (highlighted in yellow) — please fill in every cell before submitting. / Harap isi semua kolom yang kosong.` : "";
      const next = !n && needsJa();
      $("to-ja").classList.toggle("next", next); $("to-ja").classList.toggle("ghost", !next); $("to-ja-tag").hidden = !next;
    };
    const mountFormula = () => { tF = editTable($("t-formula"), formulaCols(), sp.formula, () => { recalcPct(); save.soon(); refreshCues(); }, { totalCheck: true }); refreshCues(); };
    $("f-unit").value = sp.formulaUnit;
    $("f-unit").onchange = () => {
      const prev = sp.formulaUnit; sp.formulaUnit = $("f-unit").value;
      if (sp.formulaUnit !== "%" && prev === "%") sp.formula.forEach((r) => (r.amt = r.amt || r.pct || ""));
      recalcPct(); save.soon(); $("t-formula").innerHTML = ""; mountFormula();
    };
    mountFormula();

    // Import a formula sheet (PDF, Excel, CSV or photo): AI reads it, the supplier checks the preview, then it is applied.
    const readB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
    const drop = $("f-drop"), dropSt = $("st-drop");
    const fMeta = () => ({ project: snap.name, company: S.company?.name, logo: logoUrls[S.company?.logo_path], unit: sp.formulaUnit, rows: sp.formula.filter((r) => r.trade || r.idName || r.inci), requester: rq.requester });
    $("f-xlsx").onclick = async () => download(fileBase(snap.name, "formula") + ".xlsx", await formulaXlsx(fMeta()));
    $("f-pdf").onclick = (e) => busy(e.currentTarget, $("st-toja"), "Making the PDF… / Membuat PDF…", async () => {
      if (!fMeta().rows.length) throw { userMsg: "The formula is empty. / Formula masih kosong." };
      download(fileBase(snap.name, "formula") + ".pdf", await formulaPdf(fMeta())); $("st-toja").textContent = "✓ PDF saved / PDF tersimpan";
    });
    // On submit: the formula goes to Japan as Excel + PDF too (stored with the attachments, attached to the email).
    const attachFormulaFiles = async () => {
      const m = fMeta(), stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""), made = [];
      for (const [ext, blob, type] of [["xlsx", await formulaXlsx(m), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["pdf", await formulaPdf(m), "application/pdf"]]) {
        const name = `${fileBase(snap.name, "formula")}_${stamp}.${ext}`, path = `${a.company_id}/${aid}/${Date.now()}_formula.${ext}`;
        const { error } = await sb.storage.from("attachments").upload(path, blob, { contentType: type });
        if (error) throw error;
        made.push({ path, name, cat: "Formula (auto)", desc: ext === "pdf" ? "Formula as PDF (made on submit)" : "Formula as Excel (made on submit)", type, size: blob.size, auto: true });
      }
      const old = sp.files.filter((f) => f.auto); sp.files = sp.files.filter((f) => !f.auto).concat(made); renderFiles();
      if (old.length) sb.storage.from("attachments").remove(old.map((f) => f.path));
    };
    $("tpl-dl").onclick = async () => {
      download(fileBase(snap.name, "formula_template") + ".xlsx", await formulaXlsx({ project: snap.name, company: S.company?.name, unit: "%", rows: [] }));
      toast("Template downloaded ✓", "Fill in every cell, save, then drop the file in the orange box.", "info");
    };
    // Our own template is read directly (exact, instant); anything else goes to the AI.
    const readTemplate = (XLSX, wb) => {
      const ws = wb.Sheets.Formula; if (!ws) return null;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      if (String(rows[0]?.[0] || "").trim() !== TPL_MARK) return null;
      const u = rows.find((r) => /^Amount unit/i.test(String(r[0] || "")))?.[1];
      const unit = { "%": "%", g: "g", ml: "mL" }[String(u || "%").trim().toLowerCase()] || "%";
      const h = rows.findIndex((r) => /^Phase/.test(String(r[1] || "")));
      const s = (v) => String(v ?? "").trim();
      const items = rows.slice(h + 1).filter((r) => s(r[5]) !== "Total" && [2, 3, 4, 5, 6, 7].some((j) => s(r[j])))
        .map((r) => ({ phase: s(r[1]), trade: s(r[2]), idName: s(r[3]), inci: s(r[4]), maker: s(r[5]), amt: s(r[6]), fn: s(r[7]) }));
      return { unit, items, notes: "" };
    };
    const importFile = async (file) => {
      if (!file) return;
      const name = file.name.toLowerCase(), isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
      const isSheet = /\.(xlsx|xls|csv)$/.test(name), isImg = /^image\/(jpeg|png|webp)$/.test(file.type);
      dropSt.className = "status";
      if (!isPdf && !isSheet && !isImg) { dropSt.className = "status err"; dropSt.textContent = "Please use a PDF, Excel (.xlsx/.xls), CSV, JPG or PNG file."; return; }
      if (file.size > 10 * 1024 * 1024) { dropSt.className = "status err"; dropSt.textContent = "The file is larger than 10 MB. Please send a smaller file."; return; }
      drop.classList.add("busy"); dropSt.textContent = `Reading ${file.name}… (20–60 seconds) / Membaca file…`; $("drop-preview").innerHTML = "";
      try {
        let source = "", opts = { effort: "medium" }, res = null;
        if (/\.xlsx?$/.test(name)) { const XLSX = await lib("XLSX"), wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); res = readTemplate(XLSX, wb); if (!res) source = "this spreadsheet (converted to CSV):\n" + wb.SheetNames.map((n) => `### Sheet: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n").slice(0, 60000); }
        else if (isPdf) { opts.document = { media_type: "application/pdf", data: await readB64(file) }; source = "the attached PDF"; }
        else if (isImg) { opts.image = { media_type: file.type, data: await readB64(file) }; source = "the attached photo"; }
        else { source = "this CSV:\n" + (await file.text()).slice(0, 60000); }
        if (!res) res = await ai(`You are a cosmetic formulation assistant. Extract the cosmetic formula from ${source}
Rules:
- List every raw material row in the original order. Skip headers, totals and blank rows.
- Copy names and numbers exactly. Do not invent, round or change any value. Leave a field "" when it is not shown.
- Fields per row: phase (e.g. A/B/C), trade (trade name), idName (Indonesian label name / Nama bahan), inci (INCI name), maker (supplier or manufacturer), amt (the amount as written, number only), fn (function, only if shown).
- unit: "%" if the amounts are percentages (w/w) or add up to about 100; "g" if grams; "mL" if millilitres.
- notes: anything unclear or unreadable, in English, short. "" if none.
Reply with JSON only: {"unit":"%","items":[{"phase":"","trade":"","idName":"","inci":"","maker":"","amt":"","fn":""}],"notes":""}`, opts);
        const items = (Array.isArray(res.items) ? res.items : []).filter((x) => x && (x.trade || x.idName || x.inci));
        if (!items.length) throw { userMsg: "No formula rows were found in this file. Please check the file or enter the rows by hand." };
        const unit = ["%", "g", "mL"].includes(res.unit) ? res.unit : "%";
        const tot = items.reduce((a, x) => a + num(x.amt), 0);
        const F7 = ["phase", "trade", "idName", "inci", "maker", "amt", "fn"], empty = items.reduce((a, x) => a + F7.filter((k) => !String(x[k] ?? "").trim()).length, 0);
        dropSt.textContent = `✓ ${items.length} rows found (${unit === "%" ? `total ${fmt(tot)}%` : `total ${fmt(tot)} ${unit}`}). Please check them, then press "Use these rows".` + (empty ? ` ${empty} empty cell${empty > 1 ? "s" : ""} (yellow) must be filled in after importing.` : "");
        $("drop-preview").innerHTML = `<div class="confirm-box">${res.notes ? `<div class="status err" style="margin:0">Note: ${esc(res.notes)}</div>` : ""}
          <div class="tbl-wrap"><table class="view"><thead><tr><th>No.</th><th>Phase</th><th>Trade name</th><th>Nama bahan</th><th>INCI</th><th>Maker</th><th>Amount (${esc(unit)})</th><th>Function</th></tr></thead><tbody>
          ${items.map((x, i) => `<tr><td class="no">${i + 1}</td>${F7.map((k) => `<td class="${k === "inci" ? "inci " : k === "amt" ? "num " : ""}${String(x[k] ?? "").trim() ? "" : "miss"}">${esc(x[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <div class="row"><button type="button" class="btn saff" id="imp-replace">Use these rows${sp.formula.length ? " (replace current table)" : ""}</button>
          ${sp.formula.length ? '<button type="button" class="btn ghost" id="imp-append">Add below current rows</button>' : ""}<button type="button" class="btn ghost" id="imp-cancel">Cancel</button></div></div>`;
        const apply = (replace) => {
          const rows = items.map((x) => ({ phase: String(x.phase || ""), trade: String(x.trade || ""), idName: String(x.idName || ""), inci: String(x.inci || ""), maker: String(x.maker || ""), fn: String(x.fn || ""), ...(unit === "%" ? { pct: String(x.amt || "") } : { amt: String(x.amt || "") }) }));
          if (replace) { sp.formula.splice(0, sp.formula.length, ...rows); sp.formulaUnit = unit; }
          else { if (sp.formulaUnit !== unit) { dropSt.className = "status err"; dropSt.textContent = `The file uses "${unit}" but the table uses "${sp.formulaUnit}". Please replace the table instead.`; return; } sp.formula.push(...rows); }
          $("f-unit").value = sp.formulaUnit; recalcPct(); $("t-formula").innerHTML = ""; mountFormula(); save.soon();
          $("drop-preview").innerHTML = ""; const nb = blanks().length;
          dropSt.textContent = nb ? `✓ ${rows.length} rows added. Next, fill in the empty (yellow) cells, then press "Convert to Japanese names" (top right).` : `✓ ${rows.length} rows added. Next, press "Convert to Japanese names" (top right, highlighted).`;
          $("to-ja").scrollIntoView({ behavior: "smooth", block: "center" });
          toast("Formula imported ✓", `${rows.length} rows`);
        };
        $("imp-replace").onclick = () => apply(true);
        if ($("imp-append")) $("imp-append").onclick = () => apply(false);
        $("imp-cancel").onclick = () => { $("drop-preview").innerHTML = ""; dropSt.textContent = ""; };
      } catch (e) {
        dropSt.className = "status err"; dropSt.textContent = e?.userMsg || "The file could not be read. Please try again or enter the rows by hand.";
      } finally { drop.classList.remove("busy"); }
    };
    drop.onclick = () => $("f-drop-in").click();
    drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("f-drop-in").click(); } };
    $("f-drop-in").onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ""; importFile(f); };
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => importFile(e.dataTransfer?.files?.[0]));
    const tM = editTable($("t-materials"), COLS.materials, sp.materials, save.soon);
    const tT = editTable($("t-tests"), COLS.tests, sp.tests, save.soon);
    $("add-formula").onclick = () => tF.add(); $("add-materials").onclick = tM.add; $("add-tests").onclick = tT.add;
    $("to-ja").onclick = (e) => busy(e.currentTarget, $("st-toja"), "Converting… / 変換しています…", async () => {
      const n = await convertToJapanese(sp.formula); $("t-formula").innerHTML = ""; mountFormula(); save.soon(); await save.now();
      $("st-toja").textContent = `✓ ${n} rows converted. Please check the notes column (確認事項) if any.`;
    });

    const renderFiles = () => {
      $("files").innerHTML = sp.files.length ? sp.files.map((f, i) => `<div class="file"><span class="cat">${esc(f.cat)}</span><div><button class="linkbtn" data-open="${i}">${esc(f.name)}</button>${f.desc ? `<div class="d">${esc(f.desc)}</div>` : ""}</div><button class="x" data-rm="${i}" aria-label="Remove">×</button></div>`).join("") : `<div class="hint">No files yet.</div>`;
    };
    $("files").onclick = async (e) => {
      const o = e.target.closest("[data-open]"), r = e.target.closest("[data-rm]");
      if (o) openFile(sp.files[+o.dataset.open].path);
      if (r) { const f = sp.files.splice(+r.dataset.rm, 1)[0]; renderFiles(); save.soon(); if (f) await sb.storage.from("attachments").remove([f.path]); }
    };
    renderFiles();
    $("f-file").onchange = async (e) => {
      const files = [...(e.target.files || [])]; e.target.value = ""; const st = $("st-upl");
      for (const f of files) {
        st.className = "status"; st.textContent = `Uploading ${f.name}…`;
        const path = `${a.company_id}/${aid}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error } = await sb.storage.from("attachments").upload(path, f, { contentType: f.type || undefined });
        if (error) { st.className = "status err"; st.textContent = `${f.name}: upload failed (${error.message})`; continue; }
        sp.files.push({ path, name: f.name, cat: $("f-cat").value, desc: $("f-desc").value.trim(), type: f.type, size: f.size });
        renderFiles(); save.soon(); await save.now(); st.textContent = `Uploaded: ${f.name}`;
      }
      $("f-desc").value = "";
    };

    const sh = Object.assign({}, a.shipment || {});
    const SH = ["carrier", "tracking", "date", "qty", "note"];
    SH.forEach((k) => ($("s-" + k).value = sh[k] || ""));
    { const m = String(sh.qty || "").match(/^\s*([\d.,]+)\s*(.*)$/); if (m) { $("s-qty").value = m[1]; if ([...$("s-qtyu").options].some((o) => o.value === m[2])) $("s-qtyu").value = m[2]; } }
    const shipState = () => {
      const ok = status === "submitted";
      $("ship").disabled = !ok;
      $("st-ship").className = "status";
      $("st-ship").textContent = a.shipped_at ? `✓ Shipped: ${dt(a.shipped_at)} (tracking ${sh.tracking || ""})` : ok ? "" : "Submit sections A–E first. / Kirim bagian A–E terlebih dahulu.";
    };
    shipState();
    $("ship").onclick = (e) => busy(e.currentTarget, $("st-ship"), "Sending…", async () => {
      SH.forEach((k) => (sh[k] = $("s-" + k).value.trim()));
      if (sh.qty) sh.qty = `${sh.qty} ${$("s-qtyu").value}`;
      if (!sh.tracking) throw { userMsg: "Please enter the tracking number. / Harap isi nomor resi." };
      const { data: up, error } = await sb.from("assignments").update({ shipment: sh, shipped_at: new Date().toISOString() }).eq("id", aid).select("shipped_at").single();
      if (error) throw { userMsg: "Could not save: " + error.message };
      a.shipped_at = up.shipped_at; a.shipment = sh;
      const { data: r } = await sb.functions.invoke("notify", { body: { event: "shipped", assignment_id: aid } });
      shipState();
      toast("Done: shipment reported ✓", r?.sent ? "Japan's development team has been emailed with the tracking number." : "Japan will see it on the master screen.");
    });

    $("submit").onclick = (e) => busy(e.currentTarget, $("st-submit"), "Submitting…", async () => {
      const miss = [], tot = sp.formula.reduce((x, r) => x + num(r.pct), 0);
      if (!sp.product.name) miss.push("Product name");
      if (!sp.formula.length) miss.push("Formula");
      else if (Math.abs(tot - 100) > 0.01) miss.push(sp.formulaUnit === "%" ? `Formula total is ${fmt(tot)}% (must be 100%)` : "Formula amounts");
      const b = blanks(); if (b.length) miss.push("Empty cells in the formula — " + b.slice(0, 5).map((x) => `row ${x.i + 1}: ${x.m.join(", ")}`).join("; ") + (b.length > 5 ? " …" : ""));
      if (miss.length) throw { userMsg: "Please check: " + miss.join(", ") };
      if (needsJa()) { $("st-submit").textContent = "Converting to Japanese names first… / 日本語表示名称に変換しています…"; await convertToJapanese(sp.formula); $("t-formula").innerHTML = ""; mountFormula(); }
      $("st-submit").textContent = "Making the formula Excel + PDF… / Membuat Excel + PDF…";
      let fileNote = "";
      try { await attachFormulaFiles(); } catch (err) { console.error(err); fileNote = " (The Excel/PDF copy could not be attached; Japan can still see the formula.)"; }
      $("st-submit").textContent = "Submitting…";
      await save.now();
      const { error } = await sb.from("assignments").update({ supplier: sp, status: "submitted" }).eq("id", aid);
      if (error) throw { userMsg: "Could not submit: " + error.message };
      status = "submitted";
      const { data: r } = await sb.functions.invoke("notify", { body: { event: "submit", assignment_id: aid } });
      $("st-submit").className = "status"; $("st-submit").textContent = "✓ Done: submitted to Japan." + (r?.sent ? " Japan has been emailed (with the formula Excel + PDF)." : "") + fileNote;
      shipState(); $("ship-card").scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Done: submitted to Japan ✓", r?.sent ? "Japan's development team has been notified by email." : "Japan will see it on the master screen. Terima kasih!");
      document.querySelector(".who").classList.add("is-done"); document.querySelector(".who .state").textContent = "Done ✓";
    });

  }

  async function supplierCompany() {
    const c = S.company || {}; await loadLogos([c]);
    const F = [["name", "Company name"], ["contact_name", "Contact person"], ["contact_email", "Contact email"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["address", "Address"], ["website", "Website"], ["nib", "Business ID (NIB)"], ["halal", "Halal certification"], ["materials", "Main raw materials"]];
    app.innerHTML = `<div class="who id">${FLAG_ID}Company profile / Profil perusahaan</div><form class="card en" id="f-co">
      ${F.map(([k, l]) => `<div class="field"><label for="c-${k}">${l}</label><input id="c-${k}" value="${esc(c[k] || "")}"></div>`).join("")}
      <div class="field"><label for="c-logo">Company logo (JPG) * / Logo perusahaan</label><div class="logo-in">${logoImg(c, 72)}<input id="c-logo" type="file" accept="image/jpeg,image/png"><span id="c-logo-prev"></span></div><div class="status" id="st-logo"></div></div>
      <p class="sub">NDA agreed: ${dt(c.nda_agreed_at)}</p><button class="btn" type="submit">Save</button><div class="status" id="st-co"></div></form>`;
    $("c-logo").onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return; const st = $("st-logo"); st.className = "status"; st.textContent = "Uploading… / Mengunggah…";
      try { await uploadLogo(S.company, f); st.textContent = "✓ Logo saved / Logo tersimpan"; supplierCompany(); } catch (err) { st.className = "status err"; st.textContent = err?.userMsg || "Upload failed"; }
    };
    $("f-co").onsubmit = async (e) => {
      e.preventDefault(); const patch = {}; F.forEach(([k]) => (patch[k] = $("c-" + k).value.trim()));
      const { error } = await sb.from("companies").update(patch).eq("id", c.id);
      $("st-co").textContent = error ? "Could not save: " + error.message : "Saved ✓"; if (!error) Object.assign(S.company, patch);
    };
  }

  /* ---------------- Company logos (JPG, private bucket, shown through signed URLs) ---------------- */
  const logoUrls = {};
  async function loadLogos(list) {
    const need = [...new Set(list.map((c) => c?.logo_path).filter((x) => x && !logoUrls[x]))];
    if (!need.length) return;
    try {
      const { data } = await sb.storage.from("attachments").createSignedUrls(need, 60 * 60 * 6);
      (data || []).forEach((x, i) => { if (x?.signedUrl) logoUrls[need[i]] = x.signedUrl; });
    } catch { /* logos are optional to display */ }
  }
  function logoImg(c, size = 40) {
    const u = c?.logo_path && logoUrls[c.logo_path];
    if (u) return `<img class="co-logo" src="${esc(u)}" alt="${esc(c.name)}" style="width:${size}px;height:${size}px">`;
    const ini = String(c?.name || "?").replace(/^(PT|CV)\.?\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return `<span class="co-logo none" style="width:${size}px;height:${size}px;font-size:${Math.max(10, Math.round(size / 2.8))}px" title="ロゴ未登録 / No logo">${esc(ini)}</span>`;
  }
  // Resize to at most 480px and save as JPG, so every logo looks alike and stays small.
  async function toJpeg(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw { userMsg: "JPG（または PNG）の画像を選んでください。 / Please choose a JPG image." };
    if (file.size > 8 * 1024 * 1024) throw { userMsg: "画像が大きすぎます（8MBまで）。 / The image is larger than 8 MB." };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 480 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.9));
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadLogo(company, file) {
    const blob = await toJpeg(file), path = `${company.id}/logo/logo-${Date.now()}.jpg`;
    const { error } = await sb.storage.from("attachments").upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw { userMsg: "ロゴをアップロードできませんでした / Upload failed: " + error.message };
    const { error: e2 } = await sb.from("companies").update({ logo_path: path }).eq("id", company.id);
    if (e2) throw { userMsg: "ロゴを保存できませんでした / Could not save: " + e2.message };
    if (company.logo_path) sb.storage.from("attachments").remove([company.logo_path]);
    company.logo_path = path; await loadLogos([company]); return path;
  }
  const logoPreview = (input, box) => { input.onchange = () => { const f = input.files?.[0]; box.innerHTML = f ? `<img class="co-logo" style="width:72px;height:72px" alt="" src="${URL.createObjectURL(f)}">` : ""; }; };

  /* ================= ADMIN (Japan) ================= */
  async function loadCompanies() {
    const [{ data }, { data: people }] = await Promise.all([sb.from("companies").select("*").order("created_at"), sb.from("profiles").select("full_name, email, company_id, role")]);
    S.companies = data || []; S.people = (people || []).filter((x) => x.company_id && x.role !== "admin");
    await loadLogos(S.companies); return S.companies;
  }
  // Full company details, so the right manufacturer is chosen.
  function coCard(c, a) {
    // Company, contact person and login users are always shown (「未登録」 when empty) so the right maker is chosen.
    const must = (label, v) => `<div><span class="k">${label}</span>${v ? esc(v) : '<span class="unset">未登録</span>'}</div>`;
    const line = (label, v) => (v ? `<div><span class="k">${label}</span>${esc(v)}</div>` : "");
    const users = (S.people || []).filter((x) => x.company_id === c.id).map((x) => x.full_name ? `${x.full_name}（${x.email}）` : x.email).join("、");
    return `<div class="co-card"><div class="co-head">${logoImg(c, 52)}<div>${FLAG_ID}<span class="co-lbl">会社名</span><div class="co-name">${esc(c.name)}</div></div></div>${a ? `<div class="co-st">${chip(a.status)}</div>` : ""}
      <div class="co-grid">${must("担当者名", c.contact_name)}${must("ログイン者", users)}${must("メール", c.contact_email)}${must("電話", c.phone || c.whatsapp)}
        ${line("所在地", c.address)}${line("取扱原料", c.materials)}${line("NIB", c.nib)}${line("ハラール", c.halal)}</div></div>`;
  }
  const needsFeedback = (a) => (a.status === "submitted" || a.shipped_at) && !a.feedback_at;
  const coName = (id) => S.companies.find((c) => c.id === id)?.name || "(company)";

  // Outcome per company: adopted (final formula based on it, or feedback "採用（…）") / not adopted (feedback "不採用", or another company's formula was adopted).
  function outcomeOf(p, a) {
    const f = one(p.finals), dec = String(a.feedback?.decision || "");
    if ((f?.finalized_at && f.adopted_assignment === a.id) || dec.startsWith("採用（")) return { k: "yes", at: f?.adopted_assignment === a.id && f?.finalized_at ? f.finalized_at : a.feedback_at, why: f?.adopted_assignment === a.id && f?.finalized_at ? "完成処方に採用" : "フィードバックで採用" };
    if (dec === "不採用") return { k: "no", at: a.feedback_at, why: a.feedback?.ja || "不採用" };
    if (f?.finalized_at && f.adopted_assignment && f.adopted_assignment !== a.id) return { k: "no", at: f.finalized_at, why: "他社の処方を採用" };
    return null;
  }

  /* One company: its details and every project it was asked for. */
  async function adminCompanyDetail(cid) {
    await loadCompanies();
    const c = S.companies.find((x) => x.id === cid);
    if (!c) { app.innerHTML = `<div class="card empty">この企業は見つかりません。<a href="#/">← マスター画面</a></div>`; return; }
    const { data: rows } = await sb.from("assignments").select("id, project_id, status, requested_at, submitted_at, shipped_at, feedback, feedback_at, updated_at, request_snapshot").eq("company_id", cid).order("requested_at", { ascending: false });
    const { data: projects } = await sb.from("projects").select("id, name, request, finals(finalized_at, adopted_assignment)");
    const pj = (id) => (projects || []).find((p) => p.id === id) || { id, name: "(案件)" };
    const list = (rows || []).filter((a) => a.status !== "draft").map((a) => ({ a, p: pj(a.project_id), o: outcomeOf(pj(a.project_id), a) }));
    const cnt = (f) => list.filter(f).length;
    const res = (o) => (o ? (o.k === "yes" ? '<span class="chip done">採用</span>' : '<span class="chip draft">不採用</span>') : '<span class="muted">—</span>');
    app.innerHTML = `<div class="head" style="margin-bottom:12px"><a href="#/">← マスター画面</a></div>
      <div class="card co-detail"><div class="co-head" style="display:flex;gap:14px;align-items:center">${logoImg(c, 72)}<div><div class="co-lbl">${FLAG_ID}会社名</div><div class="co-name" style="margin:0">${esc(c.name)}</div></div></div>
        <div class="co-grid" style="margin-top:10px">${[["担当者名", c.contact_name], ["メール", c.contact_email], ["電話", c.phone], ["WhatsApp", c.whatsapp], ["所在地", c.address], ["取扱原料", c.materials], ["NIB", c.nib], ["ハラール", c.halal]].map(([k, v]) => `<div><span class="k">${k}</span>${v ? esc(v) : '<span class="unset">未登録</span>'}</div>`).join("")}</div>
        <div class="kpi" style="border:0;padding:10px 0 0"><div class="nums"><div><b>${list.length}</b>依頼</div><div><b>${cnt((x) => ["requested", "developing"].includes(x.a.status))}</b>開発中</div><div><b>${cnt((x) => x.a.status === "submitted")}</b>提出済み</div><div><b style="${cnt((x) => needsFeedback(x.a)) ? "color:var(--warn)" : ""}">${cnt((x) => needsFeedback(x.a))}</b>FB待ち</div><div><b style="color:var(--ok)">${cnt((x) => x.o?.k === "yes")}</b>採用</div><div><b>${cnt((x) => x.o?.k === "no")}</b>不採用</div></div></div></div>
      <div class="card" style="margin-top:14px"><h2>${FLAG_JP}${esc(c.name)} の案件一覧</h2><div class="tbl-wrap" style="margin-top:10px"><table class="view master"><thead><tr><th>案件</th><th>依頼者</th><th>進捗</th><th>依頼日</th><th>提出日</th><th>サンプル</th><th>フィードバック</th><th>採否</th></tr></thead><tbody>
      ${list.map(({ a, p, o }) => `<tr><td><a href="#/p/${p.id}/dev">${esc(p.name)}</a><div class="muted" style="font-size:12px">${esc(p.request?.cat || "")}</div></td><td>${esc(a.request_snapshot?.request?.requester || "—")}</td><td>${chip(a.status)}</td><td>${d(a.requested_at)}</td><td>${d(a.submitted_at)}</td>
        <td>${a.shipped_at ? '<span class="chip done">発送済み</span>' : "—"}</td><td>${a.feedback_at ? `<span class="chip done">FB済み</span><div class="muted" style="font-size:11.5px">${esc(a.feedback?.decision || "")}</div>` : needsFeedback(a) ? '<span class="chip" style="border-color:var(--warn);color:var(--warn)">FB未実施</span>' : "—"}</td><td>${res(o)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">この企業への依頼はまだありません。</td></tr>`}
      </tbody></table></div></div>`;
  }

  async function adminHome() {
    await loadCompanies();
    const { data: projects } = await sb.from("projects").select("id, name, request, created_at, updated_at, assignments(id, company_id, status, requested_at, submitted_at, shipped_at, feedback, feedback_at, updated_at), finals(finalized_at, adopted_assignment), plans(created_at)").order("updated_at", { ascending: false });
    const P = projects || [];
    // Outcome per company: adopted (final formula based on it, or feedback "採用（…）") / not adopted (feedback "不採用", or another company's formula was adopted).
    const outcome = outcomeOf;
    const decided = P.flatMap((p) => (p.assignments || []).filter((a) => a.status !== "draft").map((a) => ({ p, a, o: outcome(p, a) })).filter((x) => x.o));
    const openAs = (p) => (p.assignments || []).filter((a) => a.status !== "draft" && !outcome(p, a));
    const listP = P.filter((p) => !(p.assignments || []).some((a) => a.status !== "draft") || openAs(p).length);
    const coOf = (id) => S.companies.find((c) => c.id === id);
    const decTable = (k) => { const rows = decided.filter((x) => x.o.k === k).sort((x, y) => String(y.o.at || "").localeCompare(String(x.o.at || "")));
      return `<div class="tbl-wrap"><table class="view master"><thead><tr><th>会社</th><th>案件</th><th>理由・経緯</th><th>決定日</th></tr></thead><tbody>
      ${rows.map(({ p, a, o }) => `<tr><td><div style="display:flex;gap:8px;align-items:center">${logoImg(coOf(a.company_id), 36)}<b>${esc(coName(a.company_id))}</b></div></td><td><a href="#/p/${p.id}/dev">${esc(p.name)}</a></td><td style="max-width:320px;font-size:12.5px">${esc(String(o.why).slice(0, 120))}</td><td>${d(o.at)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">まだありません</td></tr>`}</tbody></table></div>`; };
    const stats = S.companies.map((c) => {
      const as = P.flatMap((p) => p.assignments || []).filter((a) => a.company_id === c.id);
      return { c, req: as.filter((a) => a.status !== "draft").length, dev: as.filter((a) => a.status === "requested" || a.status === "developing").length, sub: as.filter((a) => a.status === "submitted").length, fb: as.filter(needsFeedback).length };
    });
    const owed = P.flatMap((p) => (p.assignments || []).filter(needsFeedback).map((a) => ({ p, a })));
    app.innerHTML = `<div class="who jp">${FLAG_JP}マスター画面<small>依頼している全社の状況・依頼内容・進捗</small></div>
      ${owed.length ? `<div class="notice off"><b>フィードバック未実施 ${owed.length}件</b>　サンプルが届いた会社には必ずフィードバックを送ってください：${owed.map(({ p, a }) => `<a href="#/p/${p.id}/dev">${esc(coName(a.company_id))}（${esc(p.name)}）</a>`).join("、")}</div>` : ""}
      <div class="head"><h2 style="margin:0">登録企業 ${S.companies.length}社</h2><button class="btn" id="new-proj">＋ 新規案件</button></div>
      <div class="kpis">${stats.map(({ c, req, dev, sub, fb }) => `<a class="kpi kpi-link" href="#/co/${c.id}" title="${esc(c.name)} の案件一覧を見る"><div class="co">${logoImg(c, 40)}<span>${esc(c.name)}</span><span class="kpi-go">案件一覧 ›</span></div>
        <div class="nums"><div><b>${req}</b>依頼</div><div><b>${dev}</b>開発中</div><div><b>${sub}</b>提出済み</div><div><b style="${fb ? "color:var(--warn)" : ""}">${fb}</b>FB待ち</div></div>
        <div class="muted" style="font-size:12px">${esc(c.contact_name || "")}　${esc(c.contact_email || "")}</div></a>`).join("") || `<div class="kpi"><div class="muted">まだ登録企業がありません。インドネシア各社にこのページのURLを送り、「Register company」から登録してもらってください。</div></div>`}</div>
      <div class="card"><h2>${FLAG_JP}案件一覧</h2><div class="tbl-wrap" style="margin-top:10px"><table class="view master"><thead><tr><th>案件</th><th>依頼先と進捗</th><th>完成処方</th><th>企画書</th><th>更新</th></tr></thead><tbody>
      ${listP.map((p) => { const as = openAs(p), nd = (p.assignments || []).filter((a) => a.status !== "draft").length - as.length, f = one(p.finals), pl = one(p.plans);
        return `<tr><td><a href="#/p/${p.id}">${esc(p.name)}</a><div class="muted" style="font-size:12px">${esc(p.request?.cat || "")}</div></td>
        <td>${as.length ? as.map((a) => `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:3px 0">${logoImg(S.companies.find((c) => c.id === a.company_id), 30)}<span>${esc(coName(a.company_id))}</span>${chip(a.status)}${a.shipped_at ? '<span class="chip done">発送済み</span>' : ""}${a.feedback_at ? '<span class="chip done">FB済み</span>' : needsFeedback(a) ? '<span class="chip" style="border-color:var(--warn);color:var(--warn)">FB未実施</span>' : ""}<span class="muted" style="font-size:11px">${a.submitted_at ? "提出 " + d(a.submitted_at) : "依頼 " + d(a.requested_at)}</span></div>`).join("") : '<span class="chip draft">未依頼</span>'}${nd ? `<div class="muted" style="font-size:11.5px;margin-top:2px">採用・不採用が決まった ${nd}社は下の欄に移動しました ↓</div>` : ""}</td>
        <td>${f?.finalized_at ? '<span class="chip done">確定 ✓</span>' : "—"}</td><td>${pl ? '<span class="chip done">完成 ✓</span>' : "—"}</td><td>${d(p.updated_at)}</td></tr>`; }).join("") || `<tr><td colspan="5" class="empty">${P.length ? "進行中の案件はありません。" : "案件はまだありません。「＋ 新規案件」から始めてください。"}</td></tr>`}
      </tbody></table></div></div>
      <div class="dec-cols">
        <div class="card dec yes"><h2>採用 <span class="muted" style="font-size:13px;font-weight:400">${decided.filter((x) => x.o.k === "yes").length}件</span></h2><p class="sub">完成処方に採用した会社、またはフィードバックで「採用」とした会社</p>${decTable("yes")}</div>
        <div class="card dec no"><h2>不採用 <span class="muted" style="font-size:13px;font-weight:400">${decided.filter((x) => x.o.k === "no").length}件</span></h2><p class="sub">フィードバックで「不採用」とした会社、または他社の処方を採用した案件</p>${decTable("no")}</div>
      </div>`;
    $("new-proj").onclick = async () => {
      const { data, error } = await sb.from("projects").insert({ name: "新規案件", created_by: S.user.id, request: { markets: ["jp"] } }).select("id").single();
      if (error) { toast("案件を作れませんでした", error.message, "info"); return; }
      location.hash = "#/p/" + data.id;
    };
  }

  async function adminCompanies() {
    await loadCompanies();
    const [{ data: logs }, terms] = await Promise.all([sb.from("agreement_log").select("company_id, doc, version, accepted_at, user_id"), loadTerms()]);
    const agreed = (cid, doc) => (logs || []).filter((l) => l.company_id === cid && l.doc === doc).sort((a, b) => b.accepted_at.localeCompare(a.accepted_at))[0];
    app.innerHTML = `<div class="who jp">${FLAG_JP}登録企業</div>
      <form class="card" id="f-sup" autocomplete="off" style="margin-bottom:14px"><h2>${FLAG_JP}＋ 仕入先の企業を登録する</h2>
        <p class="sub">当社が代わりに登録し、ログイン情報（仮パスワード）を発行します。3つの合意（NDA・購入宣言・処方の帰属）は、相手が最初にログインしたときに本人が同意します。</p>
        <div class="grid3">
          <div class="field"><label for="s-company_name">会社名 *</label><input id="s-company_name" required placeholder="PT ○○○ Indonesia"></div>
          <div class="field"><label for="s-full_name">担当者名 *</label><input id="s-full_name" required></div>
          <div class="field"><label for="s-email">担当者のメールアドレス *（ログインIDになります）</label><input id="s-email" type="email" required></div>
        </div>
        <div class="notice info" style="margin:0 0 12px">電話・住所・NIB・ハラール認証・取扱原料・<b>会社ロゴ（JPG）</b>と<b>パスワードの変更</b>は、先方が<b>初めてログインしたときに必ず入力</b>します。入力が終わるまで、先方は依頼を見られません。</div>
        <button class="btn saff" type="submit">登録してログイン情報を発行</button><div class="status" id="st-sup"></div>
        <div id="sup-result"></div></form>
      <div class="card" id="co-list"><div class="tbl-wrap"><table class="view master"><thead><tr><th>ロゴ</th><th>会社</th><th>担当者</th><th>連絡先</th><th>NIB / ハラール</th><th>主な原料</th><th>合意（NDA／購入宣言／処方帰属）</th><th>登録日</th></tr></thead><tbody>
      ${S.companies.map((c) => `<tr><td>${logoImg(c, 56)}<label class="linkbtn" style="display:block;font-size:12px;margin-top:4px;position:relative">${c.logo_path ? "ロゴを変更" : "ロゴを登録"}<input type="file" accept="image/jpeg,image/png" data-logo="${c.id}" style="position:absolute;width:1px;height:1px;opacity:0"></label>${c.logo_path ? "" : '<span class="unset" style="font-size:12px">未登録</span>'}</td><td>${FLAG_ID}<a href="#/co/${c.id}"><b>${esc(c.name)}</b></a><div class="muted" style="font-size:12px">${esc(c.address || "")}${c.website ? `<br>${esc(c.website)}` : ""}</div></td><td>${esc(c.contact_name || "")}</td>
        <td>${esc(c.contact_email || "")}<div class="muted" style="font-size:12px">${esc(c.phone || "")}${c.whatsapp ? " / WA " + esc(c.whatsapp) : ""}</div></td><td>${esc(c.nib || "—")}<div class="muted" style="font-size:12px">${esc(c.halal || "")}</div></td>
        <td style="max-width:240px">${esc(c.materials || "")}</td><td>${DOC_ORDER.map((k) => { const l = agreed(c.id, k); return `<div>${l ? `<span class="chip done">${{ nda: "NDA", purchase: "購入宣言", ip: "処方帰属" }[k]} ✓</span> <span class="muted" style="font-size:11px">${dt(l.accepted_at)}</span>` : `<span class="chip draft">${{ nda: "NDA", purchase: "購入宣言", ip: "処方帰属" }[k]} 未</span>`}</div>`; }).join("")}</td><td>${d(c.created_at)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">まだ登録がありません。</td></tr>`}
      </tbody></table></div></div>
      <div class="card" style="margin-top:14px"><h2>${FLAG_JP}合意文（日本語訳・確認用）</h2><p class="sub">相手は英語とインドネシア語の版に同意します。本番運用の前に、必ず弁護士の確認を受けてください。</p>
        ${terms.map((t) => `<h3>${esc(t.title_ja)}（版 ${esc(t.version)}）</h3><div class="brief-out ja">${esc(t.text_ja)}</div>`).join("")}</div>`;
    $("co-list").onchange = async (e) => {
      const inp = e.target.closest("[data-logo]"); if (!inp) return; const f = inp.files?.[0]; if (!f) return;
      const c = S.companies.find((x) => x.id === inp.dataset.logo);
      try { await uploadLogo(c, f); toast("完了：ロゴを登録しました", c.name); adminCompanies(); } catch (err) { toast("ロゴを登録できませんでした", err?.userMsg || String(err), "info"); }
    };
    const SF = ["company_name", "full_name", "email"];
    $("f-sup").onsubmit = (e) => { e.preventDefault(); busy(e.submitter || $("f-sup").querySelector("button"), $("st-sup"), "登録しています…", async () => {
      const body = Object.fromEntries(SF.map((k) => [k, $("s-" + k).value.trim()]));
      const { data, error } = await sb.functions.invoke("create-supplier", { body });
      let err = null; if (error) { try { err = await error.context.json(); } catch { err = { error: "network" }; } }
      if (err || !data?.ok) {
        const code = err?.error || data?.error;
        throw { userMsg: code === "already_registered" ? "このメールアドレスは既に登録されています。" : code === "is_admin_email" ? "管理者のアドレスは仕入先に使えません。" : code === "demo" ? "デモ画面では登録できません。" : "登録できませんでした：" + (err?.message || code || "") };
      }
      const url = location.origin + location.pathname;
      const msg = `Dear ${body.full_name},\n\nArtisans Production Co., Ltd. (Japan) has created your account on Formula Bridge, our formula development platform.\nArtisans Production Co., Ltd. (Jepang) telah membuat akun Anda di Formula Bridge.\n\nURL: ${url}\nEmail: ${data.email}\nTemporary password / Kata sandi sementara: ${data.password}\n\n1. Sign in with the email and temporary password above.\n2. Read and accept the three agreements (NDA, purchase declaration, ownership of adopted formulas).\n3. Set your own password and complete your company profile (address, NIB, halal status, main raw materials and your company logo as a JPG).\n\n1. Masuk dengan email dan kata sandi sementara.\n2. Setujui tiga perjanjian.\n3. Buat kata sandi baru dan lengkapi profil perusahaan (termasuk logo perusahaan dalam JPG).\n\nThis information is confidential. / Informasi ini bersifat rahasia.`;
      $("st-sup").className = "status"; $("st-sup").textContent = "✓ 完了：登録しました。下のログイン情報を相手に送ってください（仮パスワードは今だけ表示されます）。";
      $("sup-result").innerHTML = `<div class="brief-out" style="margin-top:10px" id="sup-msg"></div><div class="row" style="margin-top:8px"><button type="button" class="btn ghost" id="copy-sup">案内文をコピー（英語・インドネシア語）</button><button type="button" class="btn ghost" id="done-sup">一覧を更新</button></div>`;
      $("sup-msg").textContent = msg;
      $("copy-sup").onclick = (ev) => copy(msg, ev.currentTarget);
      $("done-sup").onclick = () => adminCompanies();
      toast("完了：仕入先を登録しました", `${body.company_name}（${data.email}）`);
    }); };
  }

  async function adminSettings() {
    const { data: rows } = await sb.from("settings").select("*");
    const conf = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    const { data: logs } = await sb.from("mail_log").select("*").order("created_at", { ascending: false }).limit(20);
    const [{ data: admins }, { data: people }] = await Promise.all([sb.from("admin_emails").select("email"), sb.from("profiles").select("email, role")]);
    const regd = (e) => (people || []).find((p) => String(p.email || "").toLowerCase() === String(e).toLowerCase());
    app.innerHTML = `<div class="who jp">${FLAG_JP}設定</div><div class="stack">
      <form class="card" id="f-set"><h2>メールの設定</h2><p class="sub">インドネシア側からの提出は「開発専用メールアドレス」に自動で届きます。</p>
        <div class="field"><label for="s-dev">開発専用メールアドレス（複数はカンマ区切り）</label><input id="s-dev" type="text" value="${esc(conf.dev_email || "")}" placeholder="dev@example.co.jp"></div>
        <div class="field"><label for="s-from">送信元（例: 処方ブリッジ &lt;noreply@御社ドメイン&gt;）</label><input id="s-from" value="${esc(conf.from_email || "")}" placeholder="未設定の場合はテスト用の送信元を使います"></div>
        <div class="field"><label for="s-url">このサイトのURL（メール内のリンク先）</label><input id="s-url" value="${esc(conf.app_url || location.origin + location.pathname.replace(/index\.html$/, ""))}"></div>
        <div class="row"><button class="btn" type="submit">保存</button><button class="btn ghost" type="button" id="mail-test">テストメールを送る</button></div><div class="status" id="st-set"></div></form>
      <div class="card"><h2>AIの接続確認</h2><p class="sub">企画書は Claude・GPT・Gemini の3社のAIを使います。鍵（APIキー）が登録されているか、実際につながるかを確認します（鍵の中身は表示しません）。</p>
        <button class="btn ghost" type="button" id="ai-test">3社のAIの接続を確認する</button><div class="status" id="st-ai"></div></div>
      <div class="card"><h2>管理者（日本側）のメールアドレス</h2><p class="sub">ここにあるアドレスで新規登録した人は、日本側の管理者になります。</p>
        <div class="tbl-wrap"><table class="view"><thead><tr><th>メールアドレス</th><th>状態</th><th></th></tr></thead><tbody>
        ${(admins || []).map((a) => { const r = regd(a.email); return `<tr><td class="mono">${esc(a.email)}</td><td>${r?.role === "admin" ? '<span class="chip done">利用中</span>' : r ? '<span class="chip requested">確認待ち</span>' : '<span class="chip draft">未登録</span>'}</td>
          <td>${r?.role === "admin" ? "" : `<button class="btn ghost" data-invite="${esc(a.email)}">招待メールを送る</button>`}</td></tr>`; }).join("")}
        </tbody></table></div><div class="status" id="st-inv"></div>
        <div class="row"><input id="adm-new" type="email" placeholder="staff@example.co.jp" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--ground);color:var(--ink)"><button class="btn ghost" id="adm-add">追加</button></div></div>
      <div class="card"><h2>メール送信の記録（最新20件）</h2><div class="tbl-wrap"><table class="view"><thead><tr><th>日時</th><th>種類</th><th>宛先</th><th>件名</th><th>結果</th></tr></thead><tbody>
        ${(logs || []).map((l) => `<tr><td>${dt(l.created_at)}</td><td>${{ request: "依頼", submit: "提出", shipped: "発送", feedback: "フィードバック", test: "テスト", invite: "招待" }[l.kind] || esc(l.kind)}</td><td>${esc(l.to_email)}</td><td>${esc(l.subject)}</td><td>${l.ok ? '<span class="chip done">送信済み</span>' : `<span class="chip draft" title="${esc(l.detail)}">未送信</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">まだありません</td></tr>`}
      </tbody></table></div></div></div>`;
    $("f-set").onsubmit = async (e) => {
      e.preventDefault();
      const up = [["dev_email", $("s-dev").value.trim()], ["from_email", $("s-from").value.trim()], ["app_url", $("s-url").value.trim()]].map(([key, value]) => ({ key, value }));
      const { error } = await sb.from("settings").upsert(up);
      $("st-set").textContent = error ? "保存できませんでした: " + error.message : "保存しました ✓";
    };
    $("ai-test").onclick = (e) => busy(e.currentTarget, $("st-ai"), "3社のAIに接続を確認しています…（〜30秒）", async () => {
      const r = await aiRaw("status", { provider: "status" });
      const L = { claude: "Claude（Anthropic）", openai: "GPT（OpenAI）", gemini: "Gemini（Google）" }, K = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };
      $("st-ai").className = "status";
      $("st-ai").innerHTML = `<table class="ai-st">${Object.keys(L).map((k) => { const x = r[k] || {};
        return `<tr><td><b>${L[k]}</b></td><td>${!x.key ? `<span class="chip draft">鍵が未登録</span> <span class="muted">Secrets に <code>${K[k]}</code> を登録してください</span>` : x.ok ? `<span class="chip done">接続OK ✓</span> <span class="muted">${esc(x.model)}</span>` : `<span class="chip" style="border-color:var(--warn);color:var(--warn)">鍵はあるが接続できない</span> <span class="muted">${esc(x.error || "")} ${esc(x.message || "")}</span>`}</td></tr>`; }).join("")}</table>`;
    });
    $("mail-test").onclick = (e) => busy(e.currentTarget, $("st-set"), "テストメールを送っています…", async () => {
      const { data, error } = await sb.functions.invoke("notify", { body: { event: "test" } });
      if (error) throw { userMsg: "送信できませんでした（通信エラー）。" };
      $("st-set").className = data?.sent ? "status" : "status err";
      $("st-set").textContent = data?.sent ? `✓ 送信しました：${data.to.join(", ")} の受信箱を確認してください。`
        : data?.reason === "not_configured" ? "メールサーバーがまだ設定されていません（指示書の手順2を確認してください）。"
        : data?.reason === "no_dev_email" ? "開発専用メールアドレスを入れて保存してから押してください。"
        : "送信に失敗しました：" + (data?.detail || "") ;
      if (data?.reason !== "demo") setTimeout(() => adminSettings(), 4000);
    });
    document.querySelectorAll("[data-invite]").forEach((b) => (b.onclick = (e) => busy(e.currentTarget, $("st-inv"), "招待メールを送っています…", async () => {
      const email = b.dataset.invite;
      const { data, error } = await sb.functions.invoke("invite", { body: { email } });
      if (error) throw { userMsg: "送信できませんでした（通信エラー）。" };
      $("st-inv").className = data?.sent ? "status" : "status err";
      $("st-inv").textContent = data?.sent ? `✓ ${email} に招待メールを送りました。メール内のリンクからパスワードを設定してもらってください。`
        : data?.reason === "already_registered" ? `${email} は既に登録済みです。ログイン画面の「Forgot password?」からパスワードを再設定できます。`
        : data?.reason === "demo" ? "デモ画面では送信されません。"
        : `送信できませんでした：${data?.detail || ""}（メール送信の設定が済んでいない可能性があります）`;
    })));
    $("adm-add").onclick = async () => { const v = $("adm-new").value.trim(); if (!v) return; const { error } = await sb.from("admin_emails").insert({ email: v }); if (error) toast("追加できませんでした", error.message, "info"); else adminSettings(); };
  }

  /* ---------- Admin project (STEP 1–4) ---------- */
  const REQ_LABELS = [["cat", "製品カテゴリ"], ["vol", "容量"], ["bench", "ベンチマーク品"], ["feel", "目標とする使用感"], ["claim", "訴求成分・効果"], ["avoid", "使いたくない成分"], ["costRaw", "希望原料費（1本あたり）"], ["costFin", "希望完成品コスト（1本あたり・原料＋容器＋充填/製造）"], ["price", "想定販売価格（税込）"], ["date", "試作サンプル希望日"], ["note", "その他"]];
  const MK = { jp: "日本国内", id: "インドネシア", asia: "その他アジア" };

  async function adminProject(pid, step) {
    await loadCompanies();
    const [{ data: p }, { data: as }, { data: fin }, { data: plan }, { data: mk }] = await Promise.all([
      sb.from("projects").select("*").eq("id", pid).maybeSingle(),
      sb.from("assignments").select("*").eq("project_id", pid),
      sb.from("finals").select("*").eq("project_id", pid).maybeSingle(),
      sb.from("plans").select("*").eq("project_id", pid).maybeSingle(),
      sb.from("market").select("data").eq("id", "current").maybeSingle(),
    ]);
    if (!p) { app.innerHTML = `<div class="card">案件が見つかりません。<a href="#/">← マスター画面へ</a></div>`; return; }
    S.market = mk?.data || null;
    const P = { p, as: as || [], fin: fin || { project_id: pid, base_formula: [], additions: [], plan: {} }, plan: plan?.plan || null };
    const sent = P.as.filter((a) => a.status !== "draft"), subm = P.as.filter((a) => a.status === "submitted");
    const done = { req: sent.length > 0, dev: subm.length > 0 && subm.length === sent.length && subm.every((a) => a.feedback_at), fin: !!P.fin.finalized_at, plan: !!P.plan };
    step = step || "req";
    const stepBtn = (k, n, t, w, flag) => `<a role="tab" href="#/p/${pid}/${k}" aria-selected="${step === k}" class="${done[k] ? "done" : ""} ${k === "dev" ? "id-side" : ""}" style="text-decoration:none"><span class="n">${flag}${n}</span><span class="t">${t}</span><span class="w">${w}</span></a>`;
    app.innerHTML = `<div class="row" style="margin-bottom:10px"><a href="#/" class="linkbtn">← マスター画面</a><span class="spacer"></span><b>${esc(p.name)}</b></div>
      <nav class="steps" role="tablist" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${stepBtn("req", "STEP 1", "依頼", "当社が記入", FLAG_JP)}${stepBtn("dev", "STEP 2", "各社の開発", `提出 ${subm.length}/${sent.length}・FB ${subm.filter((a) => a.feedback_at).length}/${subm.length}`, FLAG_ID)}
        ${stepBtn("fin", "STEP 3", "完成処方", "当社で原料を追記", FLAG_JP)}${stepBtn("plan", "STEP 4", "企画書", "PPT / Word", FLAG_JP)}</nav>
      <section id="pv"></section>`;
    const pv = $("pv");
    if (step === "req") return stepRequest(pv, P, done);
    if (step === "dev") return stepDev(pv, P);
    if (step === "fin") return stepFinal(pv, P, done);
    if (step === "plan") return stepPlan(pv, P, done);
  }

  function stepRequest(pv, P, done) {
    const p = P.p, r = p.request = p.request || {}, brief = p.brief = p.brief || {};
    pv.innerHTML = `<div class="who jp ${done.req ? "is-done" : ""}">${FLAG_JP}日本側が入力する画面<small>依頼先の各社は、自社あての依頼だけを見られます</small><span class="state">${done.req ? "完了 ✓" : "入力中"}</span></div>
    <div class="cols"><form class="card" id="f-req" autocomplete="off"><h2>${FLAG_JP}開発依頼の内容</h2><p class="sub">入力は自動で保存されます。<span class="saved" id="saved"></span></p>
      <div class="field"><label for="r-name">案件名</label><input id="r-name" value="${esc(p.name)}"></div>
      <div class="field"><label for="r-requester">依頼者（当社の担当者名）*</label><input id="r-requester" value="${esc(r.requester ?? S.profile?.full_name ?? "")}" placeholder="例：長野 智樹"></div>
      ${REQ_LABELS.map(([k, l]) => `<div class="field"><label for="r-${k}">${l}${k === "date" ? " <small>（カレンダーから選択）</small>" : ""}</label>${["feel", "claim", "avoid", "note"].includes(k) ? `<textarea id="r-${k}">${esc(r[k] || "")}</textarea>`
        : k === "date" ? `<input id="r-date" type="date" min="${today()}" value="${/^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? esc(r.date) : ""}">${r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? `<span class="hint">以前の入力：${esc(r.date)}（カレンダーで選び直してください）</span>` : ""}`
        : `<input id="r-${k}" value="${esc(r[k] || "")}">`}</div>`).join("")}
      <div class="field"><label>販売予定の市場</label><div class="checks" id="r-markets">${Object.entries(MK).map(([k, l]) => `<label><input type="checkbox" value="${k}" ${(r.markets || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
    </form>
    <div class="stack">
      <div class="card"><div class="head"><h2>${FLAG_JP}依頼書</h2><div class="seg"><button type="button" data-b="en" aria-pressed="true">English</button><button type="button" data-b="id" aria-pressed="false">Indonesia</button><button type="button" data-b="ja" aria-pressed="false">日本語（確認用）</button></div></div>
        <div class="brief-out" id="brief"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="go-brief">依頼書を作成（英語・インドネシア語）</button><button class="btn ghost" id="copy-brief">コピー</button></div><div class="status" id="st-brief"></div></div>
      <div class="card"><h2>${FLAG_JP}依頼先を選んで送る</h2><p class="sub">選んだ会社の登録メールアドレスに、入力用リンクが自動で送られます。</p>
        <div class="pick co-tiles" id="pick">${S.companies.map((c) => { const a = P.as.find((x) => x.company_id === c.id); return `<label class="co-pick"><input type="checkbox" value="${c.id}" ${a && a.status !== "draft" ? "checked" : ""}><span class="co-tick" aria-hidden="true">選択</span>${coCard(c, a)}</label>`; }).join("") || '<div class="muted">登録企業がありません。「登録企業」の画面から仕入先を登録してください。</div>'}</div>
        <div class="row" style="margin-top:10px"><button class="btn saff big" id="send">依頼先を確認する</button></div><div class="status" id="st-send"></div><div id="send-confirm"></div></div>
    </div></div>`;
    const save = saver(async () => { const { error } = await sb.from("projects").update({ name: p.name, request: r, brief }).eq("id", p.id); if (error) throw error; }, $("saved"));
    $("r-name").oninput = (e) => { p.name = e.target.value; save.soon(); };
    if (r.requester == null) { r.requester = $("r-requester").value; save.soon(); }
    $("r-requester").oninput = (e) => { r.requester = e.target.value; save.soon(); };
    REQ_LABELS.forEach(([k]) => ($("r-" + k)[k === "date" ? "onchange" : "oninput"] = (e) => { r[k] = e.target.value; save.soon(); }));
    $("r-markets").onchange = () => { r.markets = [...$("r-markets").querySelectorAll("input:checked")].map((i) => i.value); save.soon(); };
    let bl = "en";
    const renderBrief = () => { $("brief").textContent = brief[bl] || "まだ作成していません。左を記入して「依頼書を作成」を押してください。"; $("brief").classList.toggle("ja", bl === "ja" || !brief[bl]); document.querySelectorAll("[data-b]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.b === bl))); };
    document.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => { bl = b.dataset.b; renderBrief(); }));
    renderBrief();
    $("copy-brief").onclick = (e) => copy(brief[bl] || "", e.currentTarget);
    $("go-brief").onclick = (e) => busy(e.currentTarget, $("st-brief"), "依頼書を作成しています…（20〜60秒）", async () => {
      const body = (r.requester ? [`依頼者: ${r.requester}（株式会社Artisans Production）`] : []).concat(REQ_LABELS.filter(([k]) => r[k]).map(([k, l]) => `${l}: ${r[k]}`)).concat((r.markets || []).length ? ["販売予定の市場: " + r.markets.map((m) => MK[m]).join("、")] : []).join("\n");
      if (!body) throw { userMsg: "少なくとも1項目は記入してください。" };
      const res = await ai(`あなたは日本の化粧品メーカーの開発担当者です。インドネシアの化粧品原料メーカーの処方開発担当者に送る「処方開発依頼書」を作ります。
下の日本語メモをもとに、見出し付きの簡潔な依頼書を作成してください。
- 内容を創作しない。メモにない数値や条件は書かない。記入のない項目は省く。
- 金額は円なら「JPY」表記。希望原料費と希望完成品コスト（原料＋容器＋充填・製造）は別物として明確に書き分け、原料メーカーには原料費の見積もりを依頼する。
- 使用感は処方技術者向けの技術用語（粘度感、伸び、仕上がり等）で明確に。
- 最後に「開発後に提出してほしいもの」として次を列挙: 製品の特徴、処方（% w/w・INCI名・インドネシアの原料表示名称）、主要原料の特徴とメーカーデータ・グラフ、規格書・SDS・COA、営業資料、第三者機関の試験データ。すべて英語で。
- 出力は3言語: en=英語, id=インドネシア語（丁寧なビジネス文）, ja=日本語（内容確認用の訳）。
${GLOSSARY}
JSONのみで返答: {"en": string, "id": string, "ja": string}

日本語メモ:
${body}`, { effort: "medium" });
      if (!res.en) throw { userMsg: "結果の形式が崩れました。もう一度押してください。" };
      Object.assign(brief, { en: String(res.en), id: String(res.id || ""), ja: String(res.ja || "") });
      save.soon(); await save.now(); bl = "en"; renderBrief(); $("st-brief").textContent = "作成しました。「日本語（確認用）」で内容を確認してください。";
    });
    // Step 1: show exactly who will receive the request. Step 2: send.
    $("send").onclick = () => {
      const ids = [...$("pick").querySelectorAll("input:checked")].map((i) => i.value), st = $("st-send");
      st.className = "status err";
      if (!String(r.requester || "").trim()) { st.textContent = "左の「依頼者（当社の担当者名）」を入力してください。"; $("r-requester").focus(); return; }
      if (!brief.en) { st.textContent = "先に「依頼書を作成」を押してください。"; return; }
      if (!ids.length) { st.textContent = "依頼先を1社以上選んでください。"; return; }
      st.textContent = "";
      const list = ids.map((id) => S.companies.find((c) => c.id === id)).filter(Boolean);
      $("send-confirm").innerHTML = `<div class="confirm-box"><b>依頼者：${esc(r.requester)}　／　次の${list.length}社に、案件「${esc(p.name)}」の依頼を送ります。会社名と担当者に間違いがないか確認してください。</b>
        ${list.map((c) => `<div class="co-card-wrap">${coCard(c)}</div>`).join("")}
        <div class="row" style="margin-top:10px"><button class="btn saff big" id="send-go">この${list.length}社に依頼を送る</button><button class="btn ghost" id="send-back">選び直す</button></div></div>`;
      $("send-back").onclick = () => { $("send-confirm").innerHTML = ""; };
      $("send-go").onclick = (ev) => doSend(ev.currentTarget, ids);
      $("send-confirm").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const doSend = (btn, ids) => busy(btn, $("st-send"), "送信しています…", async () => {
      $("send-confirm").innerHTML = "";
      await save.now();
      const snapshot = { name: p.name, brief: { en: brief.en, id: brief.id }, request: { requester: String(r.requester || "").trim(), requesterEmail: S.profile?.email || "", costRaw: r.costRaw || "", costFin: r.costFin || "", price: r.price || "", vol: r.vol || "", date: r.date || "" } };
      const results = [];
      for (const cid of ids) {
        const existing = P.as.find((a) => a.company_id === cid);
        const row = { project_id: p.id, company_id: cid, request_snapshot: snapshot, requested_at: new Date().toISOString() };
        if (!existing || existing.status === "draft") row.status = "requested";
        const { data: a, error } = await sb.from("assignments").upsert(row, { onConflict: "project_id,company_id" }).select("id").single();
        if (error) { results.push(`${coName(cid)}: 失敗（${error.message}）`); continue; }
        const { data: n } = await sb.functions.invoke("notify", { body: { event: "request", assignment_id: a.id } });
        results.push(`${coName(cid)}: ${n?.sent ? "メール送信済み ✓" : n?.reason === "not_configured" ? "依頼済み（メール未設定のため未送信）" : "依頼済み（メール未送信）"}`);
      }
      $("st-send").className = "status"; $("st-send").innerHTML = "✓ 完了：<br>" + results.map(esc).join("<br>");
      toast("完了：依頼を送りました", results.join(" ／ "));
      setTimeout(() => adminProject(p.id, "req"), 1500);
    });
  }

  async function stepDev(pv, P) {
    const sent = P.as.filter((a) => a.status !== "draft");
    if (!sent.length) { pv.innerHTML = `<div class="card empty">まだどの会社にも依頼していません。STEP 1 から依頼を送ってください。</div>`; return; }
    let cur = sent.find((a) => a.status === "submitted") || sent[0];
    const draw = () => {
      const sp = Object.assign({ product: {}, formula: [], materials: [], tests: [], files: [] }, cur.supplier || {});
      const rq = cur.request_snapshot?.request || {};
      pv.innerHTML = `<div class="who id ${cur.status === "submitted" ? "is-done" : ""}">${FLAG_ID}インドネシア側が入力する内容（閲覧のみ）<small>各社は自社の依頼だけを見られます</small><span class="state">${cur.status === "submitted" ? "提出済み ✓" : "未提出"}</span></div>
        <div class="cotabs">${sent.map((a) => `<button type="button" data-a="${a.id}" aria-pressed="${a.id === cur.id}">${logoImg(S.companies.find((c) => c.id === a.company_id), 26)}${esc(coName(a.company_id))} ${chip(a.status)}</button>`).join("")}</div>
        <div class="stack en">
          <div class="card"><h2>${FLAG_ID}A. Product overview</h2><p class="sub">メーカーが入力した内容（メーカー側と同じ画面配置・閲覧のみ）</p>
            <div class="targets"><div><span>${FLAG_JP}TARGET RAW MATERIAL COST / UNIT</span><b>${esc(rq.costRaw || "—")}</b></div><div><span>${FLAG_JP}TARGET FINISHED PRODUCT COST / UNIT</span><b>${esc(rq.costFin || "—")}</b></div><div><span>${FLAG_JP}PLANNED RETAIL PRICE</span><b>${esc(rq.price || "—")}</b></div></div>
            <div class="grid2 mirror">${PRODUCT_FIELDS.map(([k, l]) => { const wide = ["concept", "features", "claims", "stability", "process"].includes(k), v = sp.product[k];
              return `<div class="field ${wide ? "span2" : ""}"><label>${esc(l)}${k === "name" ? " *" : ""}</label><div class="ro-box ${wide ? "tall" : ""} ${v ? "" : "empty"}">${v ? esc(v) : "未入力 / not filled in"}</div></div>`; }).join("")}</div></div>
          <div class="card"><div class="head"><h2>${FLAG_ID}B. Base formula</h2>${(() => { const nx = sp.formula.some((r) => (r.trade || r.idName || r.inci) && !r.ja); return `<div class="to-ja-wrap">${nx ? '<span class="next-tag">▶ 未変換の原料があります</span>' : ""}<button class="btn ${nx ? "next" : "ghost"}" id="to-ja">日本語表示名称に変換</button></div>`; })()}</div><p class="sub" style="margin:0 0 8px">Amount unit / 単位：<b>${sp.formulaUnit && sp.formulaUnit !== "%" ? esc(sp.formulaUnit) + " per batch（%は自動計算）" : "% w/w（合計100%）"}</b></p><div class="tbl-wrap"><table class="edit mirror" id="t-f"></table></div>
            <div class="row" style="margin-top:8px"><span class="spacer"></span><span class="muted" style="font-size:12.5px">処方表を保存：</span><button type="button" class="btn ghost" id="a-xlsx">⬇ Excel</button><button type="button" class="btn ghost" id="a-pdf">⬇ PDF</button></div><div class="status" id="st-toja"></div></div>
          <div class="card"><h2>${FLAG_ID}C. Raw material highlights</h2><p class="sub">Features of key raw materials and the maker's data</p><div class="tbl-wrap"><table class="edit mirror" id="t-m"></table></div></div>
          <div class="card"><h2>${FLAG_ID}D. Third-party test data</h2><p class="sub">Tests by independent laboratories</p><div class="tbl-wrap"><table class="edit mirror" id="t-t"></table></div></div>
          <div class="card"><h2>${FLAG_ID}E. Attachments</h2><div class="files">${sp.files.map((f, i) => `<div class="file"><span class="cat">${esc(f.cat)}</span><div><button class="linkbtn" data-open="${i}">${esc(f.name)}</button>${f.desc ? `<div class="d">${esc(f.desc)}</div>` : ""}</div><span></span></div>`).join("") || '<div class="hint">なし</div>'}</div></div>
          <div class="card" style="${cur.shipped_at ? "border-color:var(--ok)" : ""}"><h2>${FLAG_ID}F. サンプル発送</h2>
            ${cur.shipped_at ? `<dl class="kv"><dt>発送完了の連絡</dt><dd>${dt(cur.shipped_at)}</dd><dt>運送会社</dt><dd>${esc(cur.shipment?.carrier || "—")}</dd><dt>追跡番号</dt><dd><b class="mono">${esc(cur.shipment?.tracking || "—")}</b> <button class="btn ghost" id="copy-trk">コピー</button></dd><dt>発送日</dt><dd>${esc(cur.shipment?.date || "—")}</dd><dt>数量</dt><dd>${esc(cur.shipment?.qty || "—")}</dd><dt>備考</dt><dd>${esc(cur.shipment?.note || "—")}</dd></dl>` : '<p class="muted">まだ発送の連絡はありません。</p>'}</div>
        </div>
        <div class="card" style="margin-top:14px;${cur.feedback_at ? "border-color:var(--ok)" : cur.status === "submitted" || cur.shipped_at ? "border-color:var(--warn)" : ""}">
          <h2>${FLAG_JP}当社からのフィードバック（必須）</h2>
          ${cur.feedback_at ? `<p class="sub">送信済み：${dt(cur.feedback_at)}　判定：<b>${esc(cur.feedback?.decision || "")}</b></p><div class="brief-out ja">${esc(cur.feedback?.ja || "")}</div><p class="sub" style="margin-top:10px">追加のフィードバックを送る場合は、下で書き直して再送できます。</p>` : '<p class="sub">サンプルと提出内容を確認したら、必ずフィードバックを送ってください。日本語で書けば、英語とインドネシア語に訳して相手にメールします。</p>'}
          <div class="field"><label for="fb-dec">判定</label><select id="fb-dec">${FB_DECISIONS.map(([ja]) => `<option ${cur.feedback?.decision === ja ? "selected" : ""}>${ja}</option>`).join("")}</select></div>
          <div class="field"><label for="fb-ja">コメント（日本語）</label><textarea id="fb-ja" style="min-height:120px" placeholder="例：使用感はベンチマークに近いが、べたつきが残る。増粘剤を見直して再試作をお願いしたい。">${esc(cur.feedback_at ? "" : cur.feedback?.ja || "")}</textarea></div>
          <button class="btn big" id="fb-send">英訳・インドネシア語訳して送る</button><div class="status" id="st-fb"></div></div>`;
      pv.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { cur = sent.find((a) => a.id === b.dataset.a); draw(); }));
      pv.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openFile(sp.files[+b.dataset.open].path)));
      if ($("copy-trk")) $("copy-trk").onclick = (e) => copy(cur.shipment?.tracking || "", e.currentTarget);
      $("fb-send").onclick = (e) => busy(e.currentTarget, $("st-fb"), "翻訳して送っています…", async () => {
        const ja = $("fb-ja").value.trim(), dec = FB_DECISIONS.find(([x]) => x === $("fb-dec").value);
        if (!ja) throw { userMsg: "コメントを入力してください。" };
        const r = await ai(`次は日本の化粧品メーカー（株式会社Artisans Production）から、インドネシアの原料メーカーの開発担当者へのサンプル評価フィードバックです。丁寧で具体的なビジネス文として、英語(en)とインドネシア語(id)に正確に翻訳してください。意味を足さず、数値・成分名はそのまま残すこと。
${GLOSSARY}
JSONのみで返答: {"en": string, "id": string}

判定: ${dec[0]} / ${dec[1]}
コメント:
${ja}`, { effort: "low" });
        if (!r.en) throw { userMsg: "翻訳に失敗しました。もう一度押してください。" };
        const feedback = { decision: dec[0], decision_en: dec[1], ja, en: String(r.en), id: String(r.id || ""), history: [...(cur.feedback?.history || []), ...(cur.feedback?.ja ? [{ at: cur.feedback_at, decision: cur.feedback.decision, ja: cur.feedback.ja }] : [])] };
        const { data: up, error } = await sb.from("assignments").update({ feedback, feedback_at: new Date().toISOString() }).eq("id", cur.id).select("*").single();
        if (error) throw error;
        Object.assign(cur, up);
        const { data: n } = await sb.functions.invoke("notify", { body: { event: "feedback", assignment_id: cur.id } });
        draw(); $("st-fb").textContent = "✓ 完了：フィードバックを送りました" + (n?.sent ? "（メール送信済み）" : "（メール未設定のため画面のみ）");
        toast("完了：フィードバックを送りました", `${coName(cur.company_id)} に英語・インドネシア語で届きます。`);
      });
      const fcols = sp.formulaUnit && sp.formulaUnit !== "%" ? COLS.formula.flatMap((c) => c.k === "pct" ? [{ k: "amt", l: `Amount (${sp.formulaUnit}) / batch`, w: 110, num: true, total: true }, { k: "pct", l: "% w/w (auto)", w: 90, num: true }] : [c]) : COLS.formula;
      editTable($("t-f"), fcols, sp.formula, () => {}, { totalCheck: true, readOnly: true });
      const co = S.companies.find((c) => c.id === cur.company_id), am = () => ({ project: P.p.name, company: co?.name, logo: logoUrls[co?.logo_path], unit: sp.formulaUnit || "%", rows: sp.formula, requester: cur.request_snapshot?.request?.requester });
      $("a-xlsx").onclick = async () => download(fileBase(P.p.name, "formula_" + (co?.name || "")) + ".xlsx", await formulaXlsx(am()));
      $("a-pdf").onclick = (e) => busy(e.currentTarget, $("st-toja"), "PDFを作成しています…", async () => { if (!sp.formula.length) throw { userMsg: "処方がまだありません。" }; download(fileBase(P.p.name, "formula_" + (co?.name || "")) + ".pdf", await formulaPdf(am())); $("st-toja").textContent = "✓ PDFを保存しました"; });
      editTable($("t-m"), COLS.materials, sp.materials, () => {}, { readOnly: true });
      editTable($("t-t"), COLS.tests, sp.tests, () => {}, { readOnly: true });
      $("to-ja").onclick = (e) => busy(e.currentTarget, $("st-toja"), "変換しています…", async () => {
        const n = await convertToJapanese(sp.formula); cur.supplier = sp;
        const { error } = await sb.from("assignments").update({ supplier: sp }).eq("id", cur.id); if (error) throw error;
        draw(); $("st-toja").textContent = `${n}行を変換しました。`;
      });
    };
    draw();
  }

  const FB_DECISIONS = [["採用候補", "Candidate for adoption"], ["再試作を依頼", "Please revise and send a new sample"], ["不採用", "Not adopted this time"], ["採用（本処方は当社に帰属）", "Adopted — under the Ownership of Adopted Formulas agreement, this formula now belongs to Artisans Production Co., Ltd."]];
  function isWater(r) { return /^(water|aqua)\b/i.test(String(r.inci || "").trim()) || /^(水|精製水)$/.test(String(r.ja || "").trim()) || /^air$/i.test(String(r.idName || "").trim()); }
  function finalRows(fin) {
    const base = (fin.base_formula || []).map((r) => ({ src: "base", ja: r.ja || "", jaNote: r.jaNote || "", inci: r.inci || "", label: r.ja || r.idName || r.trade || r.inci || "", pct: num(r.pct), fn: r.fn || "" }));
    const add = (fin.additions || []).map((r) => ({ src: "add", ja: r.ja || "", inci: r.inci || "", label: r.ja || r.inci || "", pct: num(r.pct), fn: r.purpose || "" }));
    return [...base, ...add].filter((r) => r.label || r.pct);
  }
  function fullList(rows) {
    const map = new Map();
    rows.forEach((r, order) => { const names = (r.ja || r.label).split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
      names.forEach((n) => { const m = map.get(n) || { n, pct: 0, order, mix: false, fn: r.fn, src: r.src }; m.pct += r.pct; m.mix = m.mix || names.length > 1; map.set(n, m); }); });
    const all = [...map.values()];
    return [...all.filter((x) => x.pct > 1).sort((a, b) => b.pct - a.pct), ...all.filter((x) => x.pct <= 1).sort((a, b) => a.order - b.order)];
  }

  function stepFinal(pv, P, done) {
    const fin = P.fin; fin.plan = fin.plan || {}; fin.additions = fin.additions || []; fin.base_formula = fin.base_formula || [];
    const subm = P.as.filter((a) => a.status === "submitted");
    const adopted = P.as.find((a) => a.id === fin.adopted_assignment);
    pv.innerHTML = `<div class="who jp ${done.fin ? "is-done" : ""}">${FLAG_JP}日本側が入力する画面<small>採用する会社のベース処方に、当社の原料を追記します</small><span class="state">${done.fin ? "完了 ✓" : "入力中"}</span></div>
    <div class="stack">
      <div class="card"><h2>${FLAG_JP}採用するベース処方</h2><p class="sub">提出済みの会社から1社を選ぶと、その処方がベースとして取り込まれます。<span class="saved" id="saved"></span></p>
        <div class="pick">${subm.map((a) => `<label><input type="radio" name="adopt" value="${a.id}" ${a.id === fin.adopted_assignment ? "checked" : ""}> ${FLAG_ID}${esc(coName(a.company_id))}<span class="muted" style="font-size:12px;margin-left:8px">${esc(a.supplier?.product?.name || "")}　原料見積: ${esc(a.supplier?.product?.cost || "—")}</span></label>`).join("") || '<div class="muted">まだ提出がありません。</div>'}</div></div>
      <div class="card"><div class="head"><h2>${FLAG_ID}採用した会社の提出内容（日本語訳）</h2><button class="btn ghost" id="tr-sup" ${adopted ? "" : "disabled"}>日本語に翻訳</button></div><div class="brief-out ja" id="sup-ja">${esc(fin.sup_ja || (adopted ? "「日本語に翻訳」を押すと表示します。" : "ベース処方を選んでください。"))}</div><div class="status" id="st-tr"></div></div>
      <div class="card"><h2>${FLAG_JP}当社で追記する原料</h2><div class="tbl-wrap"><table class="edit" id="t-add"></table></div>
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="add-row">＋ 原料を追加</button><button class="btn ghost" id="qs">水で100%に調整</button></div><div class="status" id="st-qs"></div></div>
      <div class="card"><div class="head"><h2>${FLAG_JP}完成処方</h2><span id="tot"></span></div><div class="tbl-wrap"><table class="view" id="t-final"></table></div>
        <h3>全成分表示（自動作成・配合量の多い順）</h3><div class="fulllist" id="full"></div><div class="row" style="margin-top:8px"><button class="btn ghost" id="copy-full">全成分をコピー</button></div>
        <p class="sub" style="margin-top:8px">1%以下の成分は順不同で表示できます。複数成分を含む原料（※）は並び順を要確認。</p></div>
      <div class="card"><h2>${FLAG_JP}商品計画</h2>
        <div class="targets"><div><span>希望 原料費</span><b>${esc(P.p.request?.costRaw || "—")}</b></div><div><span>希望 完成品コスト</span><b>${esc(P.p.request?.costFin || "—")}</b></div><div><span>${FLAG_ID}原料見積（採用社）</span><b>${esc(adopted?.supplier?.product?.cost || "—")}</b></div></div>
        <div class="grid2">${[["productName", "商品名"], ["brand", "ブランド名"], ["target", "ターゲット顧客"], ["price", "販売価格（税込）"], ["cost", "完成品コスト（1本・確定値）"], ["channel", "販売チャネル"], ["launch", "発売時期"], ["goal", "初年度の販売目標"]].map(([k, l]) => `<div class="field"><label for="pl-${k}">${l}</label><input id="pl-${k}" value="${esc(fin.plan[k] || "")}"></div>`).join("")}</div>
        <div class="field"><label for="pl-usp">当社としての強み・差別化ポイント</label><textarea id="pl-usp">${esc(fin.plan.usp || "")}</textarea></div></div>
      <div class="card"><h2>${FLAG_JP}完成処方を確定する</h2><p class="sub">合計100%・全原料の日本語表示名称・商品名がそろうと確定できます。</p><button class="btn big" id="fix">完成処方を確定</button><div class="status" id="st-fix"></div></div>
    </div>`;
    const save = saver(async () => { const { error } = await sb.from("finals").upsert(fin); if (error) throw error; }, $("saved"));
    const render = () => {
      const rows = finalRows(fin), tot = rows.reduce((a, r) => a + r.pct, 0);
      $("tot").innerHTML = rows.length ? `<span class="${Math.abs(tot - 100) < 0.001 ? "total-ok" : "total-bad"}">合計 ${fmt(tot)}%</span>` : "";
      $("t-final").innerHTML = `<thead><tr><th>No.</th><th>区分</th><th class="ja-col">日本語表示名称</th><th>確認事項（AI）</th><th>INCI</th><th>配合量 %</th><th>配合目的</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="no">${i + 1}</td><td><span class="badge ${r.src}">${r.src === "base" ? "ベース" : "当社追加"}</span></td><td>${esc(r.ja) || `<span class="hint">（未変換: ${esc(r.label)}）</span>`}</td><td class="jnote">${esc(r.jaNote)}</td><td class="inci">${esc(r.inci)}</td><td class="num">${fmt(r.pct)}</td><td>${esc(r.fn)}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">ベース処方を選んでください。</td></tr>'}</tbody>`;
      const list = fullList(rows); $("full").textContent = list.length ? list.map((x) => x.n + (x.mix ? "※" : "")).join("、") : "—";
    };
    const tA = editTable($("t-add"), COLS.additions, fin.additions, () => { save.soon(); render(); });
    $("add-row").onclick = tA.add;
    pv.querySelectorAll('input[name="adopt"]').forEach((r) => (r.onchange = () => {
      const a = P.as.find((x) => x.id === r.value); fin.adopted_assignment = a.id; fin.base_formula = JSON.parse(JSON.stringify(a.supplier?.formula || [])); fin.sup_ja = "";
      save.soon(); save.now().then(() => adminProject(P.p.id, "fin"));
    }));
    $("tr-sup").onclick = (e) => busy(e.currentTarget, $("st-tr"), "翻訳しています…", async () => {
      const res = await ai(`次は化粧品原料メーカー（インドネシア）の開発担当者が英語で書いた試作品の説明です。日本の化粧品メーカーの経営者が読む日本語に正確に翻訳してください。構成は保ち、数値・単位・INCI名・試験機関名はそのまま残すこと。意味を足さないこと。
${GLOSSARY}
JSONのみで返答: {"ja": string}

${supplierEnglish(adopted.supplier || {})}`, { effort: "low" });
      fin.sup_ja = String(res.ja || ""); $("sup-ja").textContent = fin.sup_ja; save.soon(); await save.now(); $("st-tr").textContent = "";
    });
    $("qs").onclick = () => {
      const w = fin.base_formula.find(isWater), st = $("st-qs");
      if (!w) { st.className = "status err"; st.textContent = "ベース処方に水（Water / Aqua）の行が見つかりません。"; return; }
      const others = finalRows(fin).reduce((a, r) => a + r.pct, 0) - num(w.pct), nw = Math.round((100 - others) * 1000) / 1000;
      if (nw < 0) { st.className = "status err"; st.textContent = "追記分が多すぎて100%を超えます。"; return; }
      w.pct = String(nw); save.soon(); render(); st.className = "status"; st.textContent = `水を ${fmt(nw)}% に調整しました（合計100%）。`;
    };
    $("copy-full").onclick = (e) => copy(fullList(finalRows(fin)).map((x) => x.n).join("、"), e.currentTarget);
    ["productName", "brand", "target", "price", "cost", "channel", "launch", "goal", "usp"].forEach((k) => ($("pl-" + k).oninput = (e) => { fin.plan[k] = e.target.value; save.soon(); }));
    $("fix").onclick = (e) => busy(e.currentTarget, $("st-fix"), "確定しています…", async () => {
      const rows = finalRows(fin), tot = rows.reduce((a, r) => a + r.pct, 0), miss = [];
      if (!rows.length) miss.push("完成処方がありません");
      else if (Math.abs(tot - 100) > 0.001) miss.push(`合計が ${fmt(tot)}% です`);
      if (rows.some((r) => !r.ja)) miss.push("日本語表示名称が未変換の原料があります（STEP 2 の変換ボタン）");
      if (!fin.plan.productName) miss.push("商品名が未入力です");
      if (miss.length) throw { userMsg: "確定できません：" + miss.join("／") };
      fin.finalized_at = new Date().toISOString(); save.soon(); await save.now();
      toast("完了：完成処方を確定しました", "STEP 4 で企画書を作れます。"); adminProject(P.p.id, "fin");
    });
    render();
  }

  const SLIDE_KEYS = [["cover", "表紙"], ["summary", "エグゼクティブサマリー"], ["market_jp", "市場動向（日本）"], ["market_asia", "市場動向（インドネシア・アジア）"], ["competitors", "競合分析"], ["concept", "製品コンセプトとターゲット"], ["formula", "処方と訴求成分"], ["evidence", "エビデンス（原料データ・第三者試験）"], ["business", "価格・販売チャネル・収益計画"], ["roadmap", "スケジュール・リスク・次のアクション"]];
  function seriesOf(mk) {
    const groups = {};
    (S.market?.markets?.[mk]?.stats || []).forEach((s) => { const v = num(s.value); if (!s.year || !v) return; const k = s.label + "|" + (s.unit || ""); (groups[k] = groups[k] || []).push(s); });
    const best = Object.values(groups).filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (!best) return null; best.sort((a, b) => String(a.year).localeCompare(String(b.year)));
    return { title: best[0].label, unit: best[0].unit || "", labels: best.map((s) => String(s.year)), values: best.map((s) => num(s.value)), source: [...new Set(best.map((s) => s.source))].join(" / ") };
  }

  function stepPlan(pv, P, done) {
    const p = P.p, fin = P.fin, adopted = P.as.find((a) => a.id === fin.adopted_assignment), sp = adopted?.supplier || {};
    const rows = finalRows(fin), tot = rows.reduce((a, r) => a + r.pct, 0);
    const checks = [[P.as.some((a) => a.status !== "draft"), "依頼を送った"], [!!adopted, "採用するベース処方を選んだ"], [rows.length > 0 && Math.abs(tot - 100) < 0.001, `完成処方の合計が100%（現在 ${fmt(tot)}%）`],
      [!!fin.finalized_at, "完成処方を確定した"], [(sp.tests || []).length > 0, "第三者試験データがある"], [!!fin.plan?.price, "販売価格を記入した"], [!!S.market, "市場データが登録されている"]];
    pv.innerHTML = `<div class="who jp ${done.plan ? "is-done" : ""}">${FLAG_JP}日本側が操作する画面<span class="state">${done.plan ? "完了 ✓" : "未作成"}</span></div>
    <div class="stack"><div class="cols">
      <div class="card"><h2>${FLAG_JP}出来上がり前のチェック</h2><p class="sub">不足があっても作れますが、その部分は【要確認】と表示されます。</p>
        <ul class="checklist">${checks.map(([ok, t]) => `<li><span class="mk ${ok ? "ok" : "ng"}">${ok ? "OK" : "未完了"}</span><span>${esc(t)}</span></li>`).join("")}</ul></div>
      <div class="card"><h2>${FLAG_JP}企画書を作る</h2><p class="sub">3社のAIで作成します：①Gemini が Google 検索で最新の市場を調査 → ②Claude がメーカー提出資料（添付PDF・画像を含む）から下書き → ③GPT が取締役目線で査読 → ④Claude が指摘を反映して仕上げ。数字は作らず、出典のないものは【要確認】と表示します。配合%は社外秘として載せません。</p>
        <button class="btn big" id="go-plan">出来上がり（企画書を作成）</button><div class="status" id="st-plan"></div>
        <h3>ダウンロード（10ページ）</h3><div class="row"><button class="btn saff" id="dl-pptx" ${P.plan ? "" : "disabled"}>PowerPoint</button><button class="btn saff" id="dl-docx" ${P.plan ? "" : "disabled"}>Word</button></div><div class="status" id="st-dl"></div>
        <h3>市場データ</h3><div class="src">${S.market ? `調査時点: ${esc(S.market.asOf || "—")}<br><span style="color:var(--warn)">${esc(S.market.verification || "")}</span>` : "未登録"}</div></div></div>
      <div class="card"><div class="head"><h2>${esc(P.plan?.title || "企画書プレビュー")}</h2><span class="saved">${P.plan ? "作成日 " + esc(P.plan.date) : ""}</span></div><div id="council"></div><div class="slides" id="slides"></div></div></div>`;
    const cn = P.plan?.council;
    if (cn) {
      const sev = { high: "重要", medium: "中", low: "軽微" }, SL = Object.fromEntries(SLIDE_KEYS);
      $("council").innerHTML = `<details class="council" open><summary>AIの分担と経過（${dt(cn.at)}）</summary>
        <ol class="cn-steps">
          <li><b>① 市場調査：</b>${cn.research ? `${esc(cn.research.model)}（Google検索）— 情報 ${cn.research.items}件、うち出典サイトを検索結果で確認できたもの ${cn.research.verified}件` : '<span class="muted">省略</span>'}</li>
          <li><b>② 下書き：</b>${esc(cn.draftModel)}${cn.attachments?.length ? `（読んだ添付資料：${cn.attachments.map(esc).join("、")}）` : "（添付資料なし）"}</li>
          <li><b>③ 査読：</b>${cn.critique ? `${esc(cn.critique.model)} — 評価 ${esc(cn.critique.score ?? "—")}/10、指摘 ${cn.critique.issues.length}件` : '<span class="muted">省略</span>'}</li>
          <li><b>④ 仕上げ：</b>${cn.finalModel ? `${esc(cn.finalModel)} — 反映 ${cn.changes.length}件／不採用 ${cn.rejected.length}件` : '<span class="muted">下書きをそのまま採用</span>'}</li></ol>
        ${cn.log?.length ? `<div class="status err">${cn.log.map(esc).join("<br>")}</div>` : ""}
        ${cn.critique ? `<h4>GPT の総評</h4><p>${esc(cn.critique.overall)}</p><div class="tbl-wrap"><table class="view"><thead><tr><th>重要度</th><th>ページ</th><th>指摘</th><th>直し方</th></tr></thead><tbody>${cn.critique.issues.map((x) => `<tr><td>${esc(sev[x.severity] || x.severity)}</td><td>${esc(SL[x.slide] || x.slide)}</td><td>${esc(x.problem)}</td><td>${esc(x.fix)}</td></tr>`).join("")}</tbody></table></div>` : ""}
        ${cn.changes?.length ? `<h4>Claude が反映した修正</h4><ul>${cn.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${cn.rejected?.length ? `<h4>採用しなかった指摘</h4><ul>${cn.rejected.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${cn.research?.sources?.length ? `<h4>Gemini が参照したWebページ（必ず開いて内容を確認してください）</h4><ul class="cn-src">${cn.research.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title || x.url)}</a></li>`).join("")}</ul>` : ""}</details>`;
    }
    const renderSlides = () => {
      const pl = P.plan;
      $("slides").innerHTML = pl ? pl.slides.map((s, i) => `<div class="slide ${s.key === "cover" ? "cover" : ""}"><span class="sn">${String(i + 1).padStart(2, "0")}</span><h4>${esc(s.key === "cover" ? pl.title : s.title)}</h4><p>${esc(s.key === "cover" ? pl.subtitle : s.lead)}</p><ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="att">${[s.chart ? "グラフ: " + esc(s.chart.title) : "", s.table ? `表 ${s.table.rows.length}行` : "", s.imagePath ? "画像" : "", (s.sources || []).length ? `出典 ${s.sources.length}件` : ""].filter(Boolean).join("　")}</div></div>`).join("") : '<div class="hint">「出来上がり」を押すと、ここに10ページの構成が表示されます。</div>';
    };
    renderSlides();
    // Plan builder (4 steps): Gemini researches the market with Google Search → Claude drafts from the supplier's data and
    // attachments → GPT reviews the draft like a board member → Claude revises. If a key is missing, that step is skipped.
    $("go-plan").onclick = (e) => busy(e.currentTarget, $("st-plan"), "企画書を作成しています…", async () => {
      const mkSel = p.request?.markets || ["jp"];
      const pick = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => mkSel.includes(k)));
      const market = S.market ? { asOf: S.market.asOf, markets: pick(S.market.markets), competitors: pick(S.market.competitors), regulatory: S.market.regulatory || [] } : null;
      const log = [], step = (i, t) => { $("st-plan").className = "status"; $("st-plan").textContent = `（${i}/4）${t}`; };
      const soft = async (label, fn) => { try { return await fn(); } catch (err) { log.push(`${label}：${err?.userMsg || "失敗"}（この工程は省略しました）`); return null; } };
      const rq = p.request || {};

      // 1) Gemini — latest market facts with sources
      step(1, "Gemini が Google 検索で最新の市場・競合・規制を調べています…（〜1分）");
      const gr = await soft("Gemini（市場調査）", () => aiRaw(`あなたは化粧品業界の市場リサーチャーです。Google検索で最新の情報を調べ、次の新商品の企画に必要な市場データを集めてください。
対象市場: ${mkSel.map((m) => MK[m] || m).join("、")}
製品: ${rq.cat || ""} ${rq.vol || ""}／訴求: ${rq.claim || ""}／ベンチマーク: ${rq.bench || ""}／想定販売価格: ${rq.price || ""}／使用感: ${rq.feel || ""}
厳守:
- 検索で確認できた事実だけを書く。推測・創作は禁止。見つからない項目は空配列にする。
- すべての項目に出典名(source)とそのページのURL(url)を付ける。数字は原文どおり、対象年(year)も書く。
- 日本語で簡潔に。
JSONのみで返答: {"asOf":"YYYY-MM","markets":{"<jp|id|asia>":{"summary":"","stats":[{"label":"","value":"","unit":"","year":"","source":"","url":""}]}},"competitors":{"<jp|id|asia>":[{"name":"","note":"","price":"","source":"","url":""}]},"trends":[{"text":"","source":"","url":""}],"regulatory":[{"text":"","source":"","url":""}]}`, { provider: "gemini", search: true }));
      let research = null;
      if (gr) {
        try {
          const j = parseJSON(gr.text), src = (gr.sources || []).slice(0, 40), doms = src.map((x) => String(x.title || "").toLowerCase()).filter(Boolean);
          const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
          const ok = (x) => x && /^https?:\/\//.test(String(x.url || ""));
          const mark = (x) => ({ ...x, verified: doms.some((d) => host(x.url) && (host(x.url).endsWith(d) || d.endsWith(host(x.url)))) });
          const mapM = (o, f) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, f(v)]));
          research = { asOf: String(j.asOf || ""), model: gr.model, queries: gr.queries || [], sources: src,
            markets: mapM(j.markets, (v) => ({ summary: String(v?.summary || ""), stats: (v?.stats || []).filter(ok).map(mark) })),
            competitors: mapM(j.competitors, (v) => (v || []).filter(ok).map(mark)), trends: (j.trends || []).filter(ok).map(mark), regulatory: (j.regulatory || []).filter(ok).map(mark) };
        } catch { log.push("Gemini（市場調査）：結果を読み取れませんでした（この工程は省略しました）"); }
      }

      // 2) Claude — draft from the supplier's data and attachments
      step(2, "Claude がメーカーの提出資料（添付PDF・画像を含む）を読み、下書きしています…（1〜3分）");
      const files = { documents: [], images: [], names: [] };
      let size = 0;
      for (const f of (sp.files || []).filter((x) => !x.auto)) {
        const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""), isImg = /^image\/(png|jpeg|webp|gif)$/.test(f.type || "");
        if ((!isPdf && !isImg) || (f.size || 0) > 8e6 || files.names.length >= 6) continue;
        try {
          const { data } = await sb.storage.from("attachments").download(f.path); if (!data) continue;
          const b64 = await blobB64(data); if (size + b64.length > 10e6) continue; size += b64.length;
          (isPdf ? files.documents : files.images).push({ media_type: isPdf ? "application/pdf" : f.type, data: b64 }); files.names.push(`${f.name}（${f.cat || "添付"}）`);
        } catch { /* skip unreadable files */ }
      }
      const input = { project: p.name, request: p.request, supplier_en: supplierEnglish(sp).slice(0, 12000), supplier_ja: (fin.sup_ja || "").slice(0, 8000), final_formula_names: rows.map((r) => ({ name: r.ja || r.label, inci: r.inci, purpose: r.fn, origin: r.src === "base" ? "インドネシア側ベース" : "当社追記" })), product_plan: fin.plan || {}, market,
        research_latest: research ? { asOf: research.asOf, markets: research.markets, competitors: research.competitors, trends: research.trends, regulatory: research.regulatory } : null, supplier_attachments: files.names };
      const RULES = `厳守事項:
- 数字（市場規模、成長率、価格、原価、販売目標、試験結果など）はデータ・添付資料にあるものだけを使う。ないものは作らず「【要確認】」と書く。
- 市場・競合・規制の記述には、データ内の source と url を sources に必ず付ける。research_latest の verified=false の項目を使うときは文頭に【要確認】を付ける。データにない市場情報は書かない。
- メーカー提出の添付資料（supplier_attachments）の内容を使ったときは sources に {"label":"メーカー提出資料：ファイル名","url":""} を付ける。
- 化粧品の効能表現は日本の薬機法の範囲（化粧品の効能56項目等）に収める。医薬品的な表現は使わない。
- 配合量（%）は社外秘なので書かない。
- 各ページ: title（20字以内）、lead（結論を1文、60字以内）、bullets（3〜6項目、各60字以内）、sources（[{label,url}]）。
- ページ構成は次の key の順で必ず10ページ: ${SLIDE_KEYS.map(([k, t]) => `${k}=${t}`).join(", ")}。
- cover の bullets には案件名・カテゴリ・販売市場・作成日(${today()})を入れる。summary は何を・なぜ今・いくらで・いつまでに。roadmap にはリスク（規制・原料調達・為替・品質）と対策、次のアクション。`;
      const draftPrompt = `あなたは上場化粧品メーカーの経営企画室長です。取締役会に出す新商品の企画書（10ページ）を日本語で作ります。
次のJSONデータと、添付されたメーカー提出資料（PDF・画像）だけを根拠に書くこと。
${RULES}
JSONのみで返答: {"title": string, "subtitle": string, "slides":[{"key":"cover","title":"","lead":"","bullets":[],"sources":[]}]}

データ:
${JSON.stringify(input)}`;
      let dr;
      try { dr = await aiRaw(draftPrompt, { effort: "high", documents: files.documents, images: files.images }); }
      catch (err) {
        if (!files.names.length || err?.code === "demo") throw err;
        log.push("添付資料を含めると処理できなかったため、添付なしで作成しました"); files.names.length = 0; input.supplier_attachments = [];
        dr = await aiRaw(draftPrompt, { effort: "high" });
      }
      const draft = parseJSON(dr.text);
      if (!Array.isArray(draft?.slides)) throw { userMsg: "結果の形式が崩れました。もう一度押してください。" };

      // 3) GPT — independent board-level review
      step(3, "GPT が取締役の目線で下書きを査読しています…（〜1分）");
      const cr = await soft("GPT（査読）", () => aiRaw(`あなたは日本の上場化粧品メーカーの社外取締役で、厳しい査読者です。次の新商品企画書の下書き（draft）を、根拠データ（data）と照らしてチェックし、日本語で指摘してください。
確認する点: dataにない数字・出典のない市場記述、論理の飛躍、リスクや対策の抜け、薬機法上問題になりうる効能表現、配合%の記載、取締役が判断するのに足りない情報。
良い点は書かなくてよい。指摘は具体的に、どのページ（slide の key）をどう直すべきか書く。最大12件。
JSONのみで返答: {"overall":"総評（100字以内）","score":1から10の整数,"issues":[{"slide":"key","severity":"high|medium|low","problem":"","fix":""}]}

data:
${JSON.stringify({ ...input, supplier_en: input.supplier_en.slice(0, 6000) })}

draft:
${JSON.stringify(draft)}`, { provider: "openai", effort: "medium" }));
      let critique = null;
      if (cr) { try { const j = parseJSON(cr.text); critique = { model: cr.model, overall: String(j.overall || ""), score: j.score, issues: (j.issues || []).slice(0, 12).map((x) => ({ slide: String(x.slide || ""), severity: String(x.severity || ""), problem: String(x.problem || ""), fix: String(x.fix || "") })) }; } catch { log.push("GPT（査読）：結果を読み取れませんでした（この工程は省略しました）"); } }

      // 4) Claude — revise with the review
      let plan = draft, fr = dr, changes = [], rejected = [];
      if (critique?.issues?.length) {
        step(4, "Claude が査読の指摘を反映して仕上げています…（1〜2分）");
        const rv = await soft("Claude（仕上げ）", () => aiRaw(`あなたは上場化粧品メーカーの経営企画室長です。企画書の下書き（draft）に対して、別のAIが査読（review）を行いました。
指摘が妥当なものは修正し、根拠データ（data）に照らして誤っている指摘や、データにない数字を求める指摘は採用しないでください。
${RULES}
JSONのみで返答: {"title": string, "subtitle": string, "slides":[...draftと同じ形...], "changes":["反映した修正（各60字以内）"], "rejected":["採用しなかった指摘と理由（各60字以内）"]}

data:
${JSON.stringify(input)}

draft:
${JSON.stringify(draft)}

review:
${JSON.stringify(critique)}`, { effort: "high" }));
        if (rv) { try { const j = parseJSON(rv.text); if (Array.isArray(j.slides)) { plan = j; fr = rv; changes = (j.changes || []).map(String).slice(0, 15); rejected = (j.rejected || []).map(String).slice(0, 15); } } catch { log.push("Claude（仕上げ）：結果を読み取れませんでした（下書きを採用しました）"); } }
      } else step(4, "仕上げています…");
      if (!Array.isArray(plan?.slides)) throw { userMsg: "結果の形式が崩れました。もう一度押してください。" };
      const byKey = Object.fromEntries(plan.slides.map((s) => [s.key, s]));
      const slides = SLIDE_KEYS.map(([k, t]) => { const s = byKey[k] || { lead: "【要確認】", bullets: [], sources: [] };
        return { key: k, title: String(s.title || t), lead: String(s.lead || ""), bullets: (s.bullets || []).map(String).slice(0, 7), sources: (s.sources || []).filter((x) => x && (x.label || x.url)).map((x) => ({ label: String(x.label || ""), url: String(x.url || "") })) }; });
      const sl = (k) => slides.find((s) => s.key === k);
      const cj = seriesOf("jp"); if (cj) sl("market_jp").chart = cj;
      const ci = seriesOf("id") || seriesOf("asia"); if (ci) sl("market_asia").chart = ci;
      const compRows = Object.entries(market?.competitors || {}).flatMap(([m, arr]) => (arr || []).slice(0, 4).map((c) => [MK[m] || m, c.name, c.note]));
      if (compRows.length) sl("competitors").table = { headers: ["市場", "企業・ブランド", "概要"], rows: compRows, caption: "出典は調査データに記載" };
      if (rows.length) sl("formula").table = { headers: ["No.", "日本語表示名称", "配合目的", "区分"], rows: fullList(rows).map((x, i) => [String(i + 1), x.n, x.fn || "", x.src === "add" ? "当社追記" : "ベース"]), caption: "配合量は社外秘のため別紙" };
      const tests = sp.tests || [], img = (sp.files || []).find((f) => /^image\/(png|jpe?g|gif)/.test(f.type || ""));
      if (tests.length) sl("evidence").table = { headers: ["試験機関", "試験項目", "方法", "結果", "日付"], rows: tests.map((t) => [t.lab, t.item, t.method, t.result, t.date].map((x) => String(x || ""))) };
      else if (img) { sl("evidence").imagePath = img.path; sl("evidence").imageCaption = img.desc || img.name; }
      if (research) { const rc = Object.entries(pick(research.competitors)).flatMap(([m, arr]) => (arr || []).slice(0, 4).map((c) => [MK[m] || m, c.name + (c.price ? `（${c.price}）` : ""), (c.verified ? "" : "【要確認】") + (c.note || "") + ` ［${c.source || ""}］`])); if (rc.length && !compRows.length) sl("competitors").table = { headers: ["市場", "企業・ブランド", "概要・出典"], rows: rc, caption: `Gemini による Google 検索（${research.asOf || today()}時点）` }; }
      P.plan = { title: String(plan.title || p.name), subtitle: String(plan.subtitle || ""), date: today(), slides,
        council: { at: new Date().toISOString(), log, attachments: files.names,
          research: research ? { model: research.model, asOf: research.asOf, queries: research.queries.slice(0, 8), sources: research.sources.slice(0, 20), verified: [...Object.values(research.markets).flatMap((m) => m.stats), ...Object.values(research.competitors).flat(), ...research.trends, ...research.regulatory].filter((x) => x.verified).length, items: [...Object.values(research.markets).flatMap((m) => m.stats), ...Object.values(research.competitors).flat(), ...research.trends, ...research.regulatory].length } : null,
          draftModel: dr.model || "Claude", critique, finalModel: fr === dr ? null : fr.model || "Claude", changes, rejected } };
      const { error } = await sb.from("plans").upsert({ project_id: p.id, plan: P.plan }); if (error) throw error;
      toast("完了：企画書ができました", (log.length ? "一部の工程を省略しました。詳細は画面の「AIの分担と経過」をご覧ください。" : "Gemini・Claude・GPT の3社AIで作成しました。") + "PowerPoint・Word ボタンから保存できます。"); adminProject(p.id, "plan");
    });
    const exportPlan = (kind) => busy($(kind === "pptx" ? "dl-pptx" : "dl-docx"), $("st-dl"), "ファイルを作成しています…", async () => {
      const pl = JSON.parse(JSON.stringify(P.plan)); pl.footer = fin.plan?.brand || "";
      for (const s of pl.slides) {
        if (!s.imagePath) continue;
        try {
          const { data } = await sb.storage.from("attachments").download(s.imagePath);
          const bmp = await createImageBitmap(data), url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(data); });
          s.image = { data: String(url).replace(/^data:/, ""), bytes: new Uint8Array(await data.arrayBuffer()), type: /png/.test(data.type) ? "png" : /gif/.test(data.type) ? "gif" : "jpg", w: bmp.width, h: bmp.height, caption: s.imageCaption || "" };
        } catch {}
      }
      const base = (pl.title || "企画書").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
      if (kind === "pptx") { const X = await lib("PptxGenJS"); download(base + ".pptx", await FBExport.buildPptx(pl, X).write({ outputType: "blob" })); }
      else { const D = await lib("docx"); download(base + ".docx", await D.Packer.toBlob(FBExport.buildDocx(pl, D))); }
      $("st-dl").textContent = "保存しました ✓";
    });
    $("dl-pptx").onclick = () => exportPlan("pptx"); $("dl-docx").onclick = () => exportPlan("docx");
  }

  /* ---------------- Translator (both roles) ---------------- */
  function viewTranslate() {
    app.innerHTML = `<div class="bar"><div class="seg"><button type="button" id="d-ja" aria-pressed="true">日本語 → Bahasa Indonesia</button><button type="button" id="d-id" aria-pressed="false">Bahasa Indonesia → 日本語</button></div></div>
      <div class="panes"><div class="pane id"><div class="pane-head"><span class="lang">${FLAG_ID}Bahasa Indonesia</span><span class="role" id="role-id">翻訳結果</span></div><textarea id="t-id" readonly></textarea>
        <div class="back" id="back-wrap"><b>逆翻訳（意味の確認用）</b><span id="back"></span></div><div class="pane-foot"><span></span><button class="btn ghost" id="c-id">コピー</button></div></div>
      <div class="pane ja"><div class="pane-head"><span class="lang">${FLAG_JP}日本語</span><span class="role" id="role-ja">ここに入力</span></div><textarea id="t-ja"></textarea>
        <div class="pane-foot"><span class="hint">Ctrl / ⌘ + Enter</span><button class="btn" id="go">翻訳する / Terjemahkan</button></div></div></div><div class="status" id="st-t"></div>`;
    let dir = "ja2id";
    const setDir = (x) => { dir = x; $("d-ja").setAttribute("aria-pressed", String(x === "ja2id")); $("d-id").setAttribute("aria-pressed", String(x === "id2ja")); $("t-ja").readOnly = x !== "ja2id"; $("t-id").readOnly = x === "ja2id"; $("role-ja").textContent = x === "ja2id" ? "ここに入力" : "翻訳結果"; $("role-id").textContent = x === "ja2id" ? "翻訳結果" : "Tulis di sini"; $("back-wrap").hidden = x !== "ja2id"; };
    $("d-ja").onclick = () => setDir("ja2id"); $("d-id").onclick = () => setDir("id2ja");
    $("c-id").onclick = (e) => copy($("t-id").value, e.currentTarget);
    const go = () => busy($("go"), $("st-t"), "翻訳しています…", async () => {
      const src = (dir === "ja2id" ? $("t-ja") : $("t-id")).value.trim(); if (!src) throw { userMsg: "文章を入力してください。" };
      const r = await ai(`あなたは日本の化粧品メーカーとインドネシアの化粧品原料メーカーの間に立つ、化粧品処方開発に詳しいプロの通訳です。
次の${dir === "ja2id" ? "日本語" : "インドネシア語"}を、ビジネスで失礼のない丁寧な${dir === "ja2id" ? "インドネシア語" : "日本語"}に翻訳してください。意味を足したり省いたりせず、数字・単位・日付・商品名・INCI名は正確に残す。
${dir === "ja2id" ? "訳文を日本語に訳し戻した逆翻訳も作る。" : ""}
${GLOSSARY}
JSONのみで返答: {"translation": string${dir === "ja2id" ? ', "back": string' : ""}}

原文:
${src}`, { effort: "low" });
      if (dir === "ja2id") { $("t-id").value = r.translation || ""; $("back").textContent = r.back || ""; } else $("t-ja").value = r.translation || "";
      $("st-t").textContent = "";
    });
    $("go").onclick = go;
    [$("t-ja"), $("t-id")].forEach((t) => t.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } }));
  }

  async function agreementsOk() {
    const [{ data: logs }, terms] = await Promise.all([sb.from("agreement_log").select("doc, version").eq("user_id", S.user.id), loadTerms()]);
    return terms.every((t) => (logs || []).some((l) => l.doc === t.doc && l.version === t.version));
  }
  async function viewAgreementGate() {
    $("nav").innerHTML = "";
    const terms = await loadTerms();
    app.innerHTML = `<div class="auth card en" style="max-width:760px"><h1>${FLAG_ID}Agreements / Perjanjian</h1>
      <p class="lang-note">Please read and agree to continue. / Harap baca dan setujui untuk melanjutkan.</p>
      <form id="f-gate"><div id="gate-terms">${termsBlock(terms)}</div><button class="btn saff" type="submit">Agree and continue / Setuju dan lanjutkan</button><div class="status" id="st-gate"></div></form></div>`;
    wireTerms($("gate-terms"));
    $("f-gate").onsubmit = async (e) => {
      e.preventDefault();
      const ag = agreedFrom($("gate-terms"));
      if (terms.some((t) => ag[t.doc] !== t.version)) { $("st-gate").className = "status err"; $("st-gate").textContent = "Please tick all boxes."; return; }
      const rows = terms.map((t) => ({ user_id: S.user.id, company_id: S.profile.company_id, doc: t.doc, version: t.version, user_agent: navigator.userAgent.slice(0, 300) }));
      const { error } = await sb.from("agreement_log").insert(rows);
      if (error) { $("st-gate").className = "status err"; $("st-gate").textContent = "Could not save: " + error.message; return; }
      if (ag.nda && S.company && !S.company.nda_agreed_at) await sb.from("companies").update({ nda_agreed_at: new Date().toISOString() }).eq("id", S.company.id);
      toast("Thank you ✓", "Agreements recorded."); route();
    };
  }

  /* First sign-in of a supplier: own password + company profile (with logo) before anything else. */
  const mustChangePassword = () => !!S.user?.user_metadata?.must_change_password;
  const needsOnboarding = () => !S.isAdmin && (mustChangePassword() || (S.company && !S.company.profile_completed_at));
  const ONB = [["phone", "Phone / Telepon", true], ["whatsapp", "WhatsApp", false], ["address", "Company address / Alamat perusahaan", true], ["website", "Website", false],
    ["nib", "Business ID (NIB) / Nomor Induk Berusaha", true], ["halal", "Halal certification (write \"None\" if none) / Sertifikasi halal", true], ["materials", "Main raw materials / Bahan baku utama", true]];
  async function viewOnboarding() {
    $("nav").innerHTML = "";
    const c = S.company || {}; await loadLogos([c]);
    const pw = mustChangePassword();
    app.innerHTML = `<div class="auth card en" style="max-width:760px"><h1>${FLAG_ID}Welcome — first-time setup</h1>
      <p class="lang-note">Please complete these steps once. You can see requests from Japan after this. / Harap lengkapi langkah berikut satu kali sebelum melihat permintaan dari Jepang.</p>
      <form id="f-onb" autocomplete="off">
        ${pw ? `<h2 style="font-size:16px;margin:14px 0 6px">1. Your own password / Kata sandi baru</h2>
        <div class="grid2"><div class="field"><label for="o-p1">New password (min. 8) *</label><input id="o-p1" type="password" minlength="8" required autocomplete="new-password"></div>
          <div class="field"><label for="o-p2">New password again *</label><input id="o-p2" type="password" minlength="8" required autocomplete="new-password"></div></div>` : ""}
        <h2 style="font-size:16px;margin:14px 0 6px">${pw ? "2" : "1"}. Company profile / Profil perusahaan</h2>
        <div class="field"><label>Company name / Nama perusahaan</label><div class="ro-box" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--ground)">${esc(c.name || "")}</div></div>
        <p class="req-note">* Required / Wajib diisi</p>
        <div class="grid2">${ONB.map(([k, l, req]) => `<div class="field ${k === "materials" || k === "address" ? "span2" : ""}"><label for="o-${k}">${l}${req ? " *" : ""}</label><input id="o-${k}" value="${esc(c[k] || "")}" ${req ? "required" : ""}></div>`).join("")}</div>
        <div class="field"><label for="o-logo">Company logo (JPG) * / Logo perusahaan</label><div class="logo-in">${logoImg(c, 72)}<input id="o-logo" type="file" accept="image/jpeg,image/png" ${c.logo_path ? "" : "required"}><span id="o-logo-prev"></span></div>
          <p class="sub" style="margin:4px 0 0">Japan uses your logo to tell suppliers apart. / Logo digunakan untuk membedakan pemasok.</p></div>
        <button class="btn saff big" type="submit">Save and continue / Simpan dan lanjutkan</button><div class="status" id="st-onb"></div></form></div>`;
    logoPreview($("o-logo"), $("o-logo-prev"));
    $("f-onb").onsubmit = (e) => { e.preventDefault(); busy(e.submitter || $("f-onb").querySelector("button"), $("st-onb"), "Saving… / Menyimpan…", async () => {
      if (pw) {
        if ($("o-p1").value !== $("o-p2").value) throw { userMsg: "The two passwords do not match. / Kata sandi tidak sama." };
        if ($("o-p1").value.length < 8) throw { userMsg: "Use at least 8 characters. / Minimal 8 karakter." };
      }
      const patch = {}; for (const [k, l, req] of ONB) { patch[k] = $("o-" + k).value.trim(); if (req && !patch[k]) throw { userMsg: "Please fill in: " + l }; }
      const f = $("o-logo").files?.[0];
      if (!f && !c.logo_path) throw { userMsg: "Please choose your company logo (JPG). / Pilih logo perusahaan (JPG)." };
      if (f) await uploadLogo(c, f);
      if (pw) {
        const { data, error } = await sb.auth.updateUser({ password: $("o-p1").value, data: { must_change_password: false } });
        if (error) throw { userMsg: "Could not change the password: " + error.message };
        if (data?.user) S.user = data.user;
      }
      patch.profile_completed_at = new Date().toISOString();
      const { error } = await sb.from("companies").update(patch).eq("id", c.id);
      if (error) throw { userMsg: "Could not save: " + error.message };
      Object.assign(S.company, patch);
      toast("Setup complete ✓ / Selesai", "Thank you. You can now see requests from Japan.");
      location.hash = "#/"; route();
    }); };
  }

  /* ---------------- Router ---------------- */
  function nav(items) {
    const h = location.hash || "#/";
    $("nav").innerHTML = items.map(([href, label]) => `<a href="${href}" class="${h === href || (href !== "#/" && h.startsWith(href)) || (href === "#/" && /^#\/(p|a)\//.test(h)) ? "on" : ""}">${label}</a>`).join("");
  }
  let pendingHash = null;
  async function route(fromLogin) {
    const h = location.hash || "#/";
    if (h.startsWith("#/update-password")) return viewUpdatePassword();
    if (!S.user) {
      if (h.startsWith("#/register")) return viewRegister();
      if (h.startsWith("#/reset")) return viewReset();
      if (/^#\/(a|p)\//.test(h)) pendingHash = h;
      return viewLogin();
    }
    if (FROM_INVITE && S.user && !sessionStorage.getItem("fb-invite-done")) { try { sessionStorage.setItem("fb-invite-done", "1"); } catch {} return viewUpdatePassword(); }
    if (fromLogin && pendingHash) { const x = pendingHash; pendingHash = null; if (location.hash !== x) { location.hash = x; return; } }
    if (!S.profile) { app.innerHTML = `<div class="card">Your account is being set up. Please reload in a moment. / アカウントを準備中です。</div>`; return; }
    $("topbar").hidden = false;
    $("me-name").textContent = (S.profile.full_name || S.profile.email || "") + (S.company ? ` — ${S.company.name}` : "");
    const parts = h.slice(2).split("/");
    if (S.isAdmin) {
      nav([["#/", "マスター画面"], ["#/companies", "登録企業"], ["#/translate", "翻訳ツール"], ["#/settings", "設定"], ["#/password", "パスワード変更"]]);
      if (parts[0] === "password") return viewUpdatePassword(true);
      if (parts[0] === "p" && parts[1]) return adminProject(parts[1], parts[2]);
      if (parts[0] === "companies") return adminCompanies();
      if (parts[0] === "co" && parts[1]) return adminCompanyDetail(parts[1]);
      if (parts[0] === "settings") return adminSettings();
      if (parts[0] === "translate") return viewTranslate();
      return adminHome();
    }
    if (!(await agreementsOk())) return viewAgreementGate();
    if (needsOnboarding()) return viewOnboarding();
    nav([["#/", "Requests / Permintaan"], ["#/company", "Company / Perusahaan"], ["#/translate", "Translate / Terjemahan"], ["#/password", "Password"]]);
    if (parts[0] === "password") return viewUpdatePassword(true);
    if (parts[0] === "a" && parts[1]) return supplierAssignment(parts[1]);
    if (parts[0] === "company") return supplierCompany();
    if (parts[0] === "translate") return viewTranslate();
    return supplierHome();
  }
  window.addEventListener("hashchange", () => route());

  /* Live notifications while the page is open */
  function live() {
    sb.channel("assignments").on("postgres_changes", { event: "UPDATE", schema: "public", table: "assignments" }, (m) => {
      const n = m.new, o = m.old || {};
      if (S.isAdmin && n.status === "submitted" && o.status !== "submitted") toast(`${coName(n.company_id)} から提出がありました`, "マスター画面・STEP 2 で確認できます。", "info");
      if (!S.isAdmin && n.status === "requested" && o.status !== "requested") toast("New request from Japan", "Permintaan baru dari Jepang.", "info");
      if (S.isAdmin && n.shipped_at && !o.shipped_at) toast(`${coName(n.company_id)} がサンプルを発送しました`, `追跡番号：${n.shipment?.tracking || ""}`, "info");
      if (!S.isAdmin && n.feedback_at && n.feedback_at !== o.feedback_at) toast("Feedback from Japan", "Umpan balik dari Jepang telah diterima.", "info");
    }).subscribe();
  }

  (async () => {
    await loadMe();
    if (S.isAdmin) await loadCompanies();
    if (S.user) live();
    route(true);
    sb.auth.onAuthStateChange(async (ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") { const had = !!S.user; await loadMe(); if (!had && S.user) live(); if (ev === "SIGNED_OUT") route(); } });
  })();
})();
