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
  // Numbers as suppliers type them (Indonesian convention: comma = decimal): "0,5" = 0.5, "1,25" = 1.25;
  // "1,000.5" and "1.000,5" = 1000.5; "1,000,000" = 1000000.
  const num = (v) => {
    let t = String(v ?? "").trim().replace(/[^\d.,\-]/g, "");
    const thousands = /^-?[1-9]\d{0,2}(,\d{3}){2,}$/.test(t); // "1,000,000" = thousands; a single comma is a decimal comma
    if (!thousands && /,\d+$/.test(t) && (!t.includes(".") || t.lastIndexOf(",") > t.lastIndexOf("."))) t = t.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(t.replace(/,/g, "")); return isFinite(n) ? n : 0;
  };
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
        <div class="seg"><button type="button" data-tl="en" aria-pressed="true">English</button><button type="button" data-tl="id" aria-pressed="false">Bahasa Indonesia</button></div></div>
      <div class="terms-text" data-en="${esc(t.text_en)}" data-id="${esc(t.text_id)}">${esc(t.text_en)}</div>
      <label class="check" style="margin-top:8px"><input type="checkbox" data-agree="${esc(t.doc)}" data-ver="${esc(t.version)}" required>
        ${t.doc === "purchase" ? "I have read and understood this declaration. / Saya telah membaca dan memahami pernyataan ini." : "I agree on behalf of my company. / Saya menyetujuinya atas nama perusahaan saya."} *</label>
      <div class="muted" style="font-size:11px">Version / Versi ${esc(t.version)}</div></div>`).join("");
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
  // A notice with one action button (used for "Undo").
  function toastAction(title, body, label, fn) {
    toast(title, body, "info");
    const b = document.createElement("button"); b.type = "button"; b.className = "btn ghost toast-act"; b.textContent = label;
    b.onclick = () => { $("toast").hidden = true; fn(); };
    $("toast-b").append(document.createElement("br"), b);
  }
  // Confirmation dialog before anything is sent or cannot be undone. body is HTML (callers escape values).
  function confirmModal({ title, body = "", ok = "OK", cancel = "キャンセル / Cancel", tone = "" }) {
    return new Promise((res) => {
      const bg = document.createElement("div"); bg.className = "modal-bg";
      bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mdl-t"><h2 id="mdl-t">${esc(title)}</h2><div class="modal-b">${body}</div>
        <div class="row modal-f"><span class="spacer"></span><button type="button" class="btn ghost" data-m="0">${esc(cancel)}</button><button type="button" class="btn ${tone}" data-m="1">${esc(ok)}</button></div></div>`;
      const done = (v) => { bg.remove(); document.removeEventListener("keydown", key); res(v); };
      const key = (e) => { if (e.key === "Escape") done(false); };
      bg.onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) done(b.dataset.m === "1"); else if (e.target === bg) done(false); };
      document.addEventListener("keydown", key); document.body.append(bg); bg.querySelector('[data-m="1"]').focus();
    });
  }
  const kvHtml = (rows) => `<dl class="modal-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}</dl>`;
  const CANCELLED = { cancel: true };
  const ask = async (opts) => { if (!(await confirmModal(opts))) throw CANCELLED; };
  // Auto-save status in the header, and a warning when leaving the page before changes are saved.
  const unsaved = new Set();
  const autosave = (state) => {
    const el = $("autosave"); if (!el) return;
    const t = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    el.className = "autosave " + state;
    el.textContent = state === "saving" ? "保存中… / Saving… / Menyimpan…" : state === "error" ? "保存できませんでした / Could not save / Gagal menyimpan" : `自動保存済み ${t} / Auto-saved / Tersimpan otomatis`;
  };
  window.addEventListener("beforeunload", (e) => { if (unsaved.size) { e.preventDefault(); e.returnValue = ""; } });

  async function copy(text, btn) {
    const old = btn.textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = "コピーしました / Copied / Tersalin"; }
    catch { btn.textContent = "コピーできませんでした / Copy failed / Gagal menyalin"; }
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
処方=formula / formula, 試作=trial sample / sampel uji coba, 使用感=sensory profile / sensasi pemakaian, ベンチマーク品=benchmark product / produk acuan,
全成分=full ingredient list (INCI) / daftar bahan lengkap, 原料=raw material / bahan baku, 規格書=specification / spesifikasi, SDS, COA,
防腐剤=preservative / pengawet, 増粘剤=thickener / pengental, 保湿剤=humectant / humektan, 乳化剤=emulsifier / pengemulsi,
安定性試験=stability test / uji stabilitas, 防腐効力試験=challenge test / uji efektivitas pengawet, 原価=cost of goods / HPP, 最低発注量=MOQ, 納期（リードタイム）=lead time / waktu tunggu, 原料費=raw material cost / biaya bahan baku, 完成品コスト=finished product cost / biaya produk jadi,
化粧品基準=Japanese Standards for Cosmetics / Standar Kosmetik Jepang, 医薬部外品=quasi-drug / quasi-drug (produk kuasi-obat Jepang), ハラール=halal, BPOM.`;
  const AI_ERR = {
    demo: "デモ画面ではAI機能（翻訳・変換・企画書作成）は動きません。 / AI is not available in the demo. / AI tidak tersedia dalam demo.",
    not_configured: "AIの設定（APIキー）がまだです。設定手順をご確認ください。 / AI is not set up yet. / AI belum diatur.",
    rate_limited: "混み合っています。1分ほど待ってからもう一度押してください。 / Busy — please try again in a minute. / Sedang sibuk — coba lagi dalam 1 menit.",
    no_credit: "AIの利用残高（クレジット）が不足しています。各社の管理画面の Billing をご確認ください。 / The AI account has no credit. / Saldo AI habis.",
    refused: "この内容は処理できませんでした。表現を変えてお試しください。 / This content could not be processed. / Konten ini tidak dapat diproses.",
    bad_request: "AIに送れない内容でした（ファイルが大きすぎる等）。 / The request could not be processed (e.g. file too large). / Permintaan tidak dapat diproses (mis. file terlalu besar).",
    empty: "AIから答えがありませんでした。もう一度押してください。 / No answer from the AI. Please try again. / AI tidak memberi jawaban. Coba lagi.",
    upstream: "AIのサービスで問題が起きました。少し待ってからもう一度押してください。 / The AI service had a problem. Please try again. / Layanan AI bermasalah. Coba lagi.",
    forbidden: "この機能は使えません。 / Not allowed. / Tidak diizinkan.",
    unauthorized: "ログインし直してください。 / Please sign in again. / Silakan masuk kembali.",
  };
  function parseJSON(text) {
    const t = String(text).trim();
    try { return JSON.parse(t); } catch {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
    const a = Math.min(...["{", "["].map((c) => (t.indexOf(c) + 1 || Infinity) - 1)), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (isFinite(a) && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    throw { userMsg: "結果の形式が崩れました。もう一度押してください。 / Unexpected result — please try again. / Hasil tidak sesuai — coba lagi." };
  }
  // provider: "claude" (default) | "gemini" (Google Search research) | "openai" (review). aiRaw keeps the model name and web sources.
  async function aiRaw(prompt, { effort = "medium", image, document, images, documents, provider, search } = {}) {
    const { data, error } = await sb.functions.invoke("ai", { body: { prompt, effort, image, document, images, documents, provider, search } });
    if (error) {
      let code = ""; try { code = (await error.context.json()).error; } catch {}
      throw { userMsg: AI_ERR[code] || "通信が途切れました。もう一度押してください。 / Connection lost. Please try again. / Koneksi terputus. Silakan coba lagi.", code };
    }
    if (data?.error) throw { userMsg: AI_ERR[data.error] || "AIの処理に失敗しました。もう一度押してください。 / The AI request failed. Please try again. / Permintaan AI gagal. Silakan coba lagi.", code: data.error };
    return data;
  }
  async function ai(prompt, opts = {}) { return parseJSON((await aiRaw(prompt, opts)).text); }
  const blobB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function busy(btn, stEl, msg, fn) {
    if (btn.disabled) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = "処理中… / Working… / Memproses…";
    if (stEl) { stEl.className = "status"; stEl.textContent = msg; }
    try { await fn(); }
    catch (e) {
      if (e === CANCELLED) { if (stEl) { stEl.className = "status"; stEl.textContent = ""; } return; }
      if (stEl) { stEl.className = "status err"; stEl.textContent = e?.userMsg || e?.message || "エラーが発生しました / Something went wrong / Terjadi kesalahan"; } console.error(e);
    }
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
  $("signout").onclick = async () => {
    await Promise.all([...unsaved].map((m) => m.flush?.())); // save the last edit first
    stopLive(); await sb.auth.signOut(); location.hash = "#/login";
  };
  let signingIn = false;
  // Supabase awaits this callback inside sign-in; do the work afterwards so that an error here can never block signing in.
  sb.auth.onAuthStateChange((ev, session) => setTimeout(async () => {
    if (ev === "PASSWORD_RECOVERY") { location.hash = "#/update-password"; return; }
    const uid = session?.user?.id || null;
    if (ev === "SIGNED_OUT") { if (S.user) { stopLive(); S.user = null; S.profile = null; S.company = null; S.isAdmin = false; route(); } return; }
    if (ev === "SIGNED_IN" && !signingIn && uid && uid !== S.user?.id) { await afterSignIn(); return; } // signed in from another tab
    if (uid && uid === S.user?.id && session?.user) S.user = session.user; // same user (tab switch, token refresh): keep the screen as it is
  }, 0));
  async function afterSignIn() { await loadMe(); if (S.isAdmin) await loadCompanies(); if (S.user) live(); route(true); }

  function viewLogin() {
    $("topbar").hidden = true;
    app.innerHTML = `<div class="auth card">
      <div style="margin-bottom:10px">${LOGO}</div>
      <h1>処方ブリッジ Formula Bridge</h1>
      <p class="lang-note">${FLAG_JP}${FLAG_ID} Sign in / Masuk / ログイン</p>
      <form id="f-login">
        <div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="l-pass">Password / Kata sandi</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
        <div class="row"><button class="btn" type="submit">Sign in / Masuk / ログイン</button><span class="spacer"></span><button class="linkbtn" type="button" id="to-reset">Forgot password? / Lupa kata sandi?</button></div>
        <div class="status" id="st-login" role="status" aria-live="polite"></div>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <p class="sub" style="margin:0">${FLAG_ID} Supplier accounts are issued by Artisans Production. Please contact your representative in Japan.<br>Akun pemasok diterbitkan oleh Artisans Production. Silakan hubungi perwakilan Anda di Jepang.<br>仕入先のアカウントは当社が発行します。</p>
    </div>`;
    $("to-reset").onclick = () => (location.hash = "#/reset");
    $("f-login").onsubmit = async (e) => {
      e.preventDefault();
      const st = $("st-login"), btn = e.submitter || $("f-login").querySelector("button[type=submit]");
      if (btn.disabled) return; btn.disabled = true; st.className = "status"; st.textContent = "Signing in… / Masuk…";
      let error; signingIn = true;
      try { ({ error } = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-pass").value })); }
      catch (x) { error = { message: String(x?.message || x) }; }
      finally { signingIn = false; btn.disabled = false; }
      if (error) { st.className = "status err"; st.textContent = /confirm/i.test(error.message) ? "Please confirm your email first (check your inbox). / Harap konfirmasi email Anda terlebih dahulu. / 確認メールのリンクを先に開いてください。" : "Email or password is incorrect. / Email atau kata sandi salah. / メールアドレスかパスワードが違います。"; return; }
      await afterSignIn();
    };
  }

  function viewReset() {
    $("topbar").hidden = true;
    app.innerHTML = `<div class="auth card"><h1>Reset password / Atur ulang kata sandi / パスワード再設定</h1>
      <form id="f-reset"><div class="field"><label for="r-email">Email</label><input id="r-email" type="email" required></div>
      <div class="row"><button class="btn" type="submit">Send reset link / Kirim tautan</button><a href="#/login" class="linkbtn">Back / Kembali</a></div>
      <div class="status" id="st-reset"></div></form></div>`;
    $("f-reset").onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.resetPasswordForEmail($("r-email").value.trim(), { redirectTo: location.origin + location.pathname + "#/update-password" });
      $("st-reset").textContent = error ? "Could not send / Gagal mengirim: " + error.message : "If the address is registered, a reset link has been sent. / Jika alamat terdaftar, tautan telah dikirim. / 登録済みなら再設定メールを送りました。";
    };
  }
  function viewUpdatePassword(inApp) {
    $("topbar").hidden = !inApp;
    app.innerHTML = `<div class="auth card"><h1>New password / Kata sandi baru / 新しいパスワード</h1>
      <form id="f-up"><div class="field"><label for="u-pass">New password (min. 8 characters) / Kata sandi baru (min. 8 karakter)</label><input id="u-pass" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn" type="submit">Save / Simpan / 保存</button><div class="status" id="st-up"></div></form></div>`;
    $("f-up").onsubmit = async (e) => {
      e.preventDefault();
      const { data, error } = await sb.auth.updateUser({ password: $("u-pass").value, data: { must_change_password: false } });
      if (error) { $("st-up").className = "status err"; $("st-up").textContent = error.message; return; }
      if (data?.user) S.user = data.user;
      toast("Password updated ✓ / Kata sandi diperbarui ✓ / パスワードを変更しました", ""); location.hash = "#/";
    };
  }

  /* ---------------- Shared: formula tables ---------------- */
  const COLS = {
    formula: [
      { k: "phase", l: "Phase / Fase", w: 60, req: true }, { k: "trade", l: "Trade name / Nama dagang", w: 150, req: true }, { k: "idName", l: "Nama bahan (Indonesian ingredient name)", w: 190, req: true },
      { k: "inci", l: "INCI name / Nama INCI", w: 190, req: true }, { k: "maker", l: "Maker / Produsen", w: 130, req: true }, { k: "pct", l: "% w/w", w: 80, num: true, req: true },
      { k: "fn", l: "Function / Fungsi", w: 120, req: true }, { k: "ja", l: "日本語表示名称", ja: true, w: 170 },
      { k: "jaNote", l: "確認事項（AI）", jn: true, ro: true, w: 280 } ],
    materials: [{ k: "material", l: "Raw material / Bahan baku", w: 180 }, { k: "feature", l: "Key feature / Keunggulan", w: 280 }, { k: "data", l: "Supporting data (supplier / literature) / Data pendukung", w: 360 }],
    tests: [{ k: "lab", l: "Laboratory / Laboratorium", w: 160 }, { k: "item", l: "Test item / Item uji", w: 170 }, { k: "method", l: "Method, n / Metode, n", w: 170 }, { k: "result", l: "Result / Hasil", w: 260 }, { k: "date", l: "Date / Tanggal", w: 100 }],
    additions: [{ k: "ja", l: "日本語表示名称", w: 200 }, { k: "inci", l: "INCI", w: 200 }, { k: "pct", l: "配合量 %", w: 90, num: true }, { k: "purpose", l: "配合目的", w: 160 }, { k: "note", l: "備考（仕入先など）", w: 200 }],
  };
  const TPL_MARK = "Formula Bridge formula template v1";
  const TPL_HEAD = ["No.", "Phase", "Trade name", "Nama bahan (Indonesian ingredient name)", "INCI name", "Supplier / maker", "Amount", "Function"];
  /* Formula as our Excel template (re-importable) — empty for the template, filled for exports. */
  async function formulaXlsx({ project, company, unit, rows }) {
    const XLSX = await lib("XLSX"), wb = XLSX.utils.book_new(), n = Math.max(40, rows.length), extra = rows.length ? ["% w/w", "日本語表示名称 (Japanese label name)", "確認事項（AI）"] : [];
    const head = TPL_HEAD.map((h) => h + (h === "No." ? "" : " *")).concat(extra);
    const cell = (v) => (v === "" || v == null ? "" : isNaN(Number(v)) ? String(v) : Number(v));
    const ws = XLSX.utils.aoa_to_sheet([[TPL_MARK], ["Fill in EVERY cell in English (Nama bahan: in Indonesian). Do not change the header row (row 7). / Isi SEMUA sel dalam bahasa Inggris (Nama bahan: dalam bahasa Indonesia). Jangan ubah baris judul kolom (baris 7)."],
      ["Project / Proyek", project || ""], ["Company / Perusahaan", company || ""], ["Amount unit (write %, g or mL) / Satuan jumlah (tulis %, g, atau mL) *", unit || "%"], [],
      head, ...Array.from({ length: n }, (_, i) => { const r = rows[i]; return r ? [i + 1, r.phase || "", r.trade || "", r.idName || "", r.inci || "", r.maker || "", cell(unit === "%" ? r.pct : r.amt), r.fn || "", cell(r.pct), r.ja || "", r.jaNote || ""] : [i + 1, "", "", "", "", "", "", ""]; }),
      ["", "", "", "", "", "Total", { f: `SUM(G8:G${7 + n})` }, "", ...(rows.length ? [{ f: `SUM(I8:I${7 + n})` }] : [])]]);
    ws["!cols"] = [8, 10, 24, 30, 30, 22, 12, 22, 10, 28, 40].map((w) => ({ wch: w }));
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Formula");
    const ex = XLSX.utils.aoa_to_sheet([["EXAMPLE — do not fill in this sheet / CONTOH — jangan isi lembar ini"], [], TPL_HEAD,
      [1, "A", "Purified water", "Air", "Water", "—", 83.7, "Solvent"], [2, "A", "Glycerin 99.5%", "Gliserin", "Glycerin", "Wilmar", 4, "Humectant"],
      [3, "B", "Ceramide NP-3", "Seramida NP", "Ceramide NP", "Evonik", 0.05, "Skin conditioning"], [4, "C", "Euxyl PE 9010", "Fenoksietanol, Etilheksilgliserin", "Phenoxyethanol, Ethylhexylglycerin", "Schülke", 0.5, "Preservative"]]);
    ex["!cols"] = [8, 10, 24, 30, 30, 22, 12, 22].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ex, "Example");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["How to fill in / Cara mengisi"], [],
      ["1", "One row per raw material, in the order you add them. / Satu baris per bahan baku, sesuai urutan penambahan."], ["2", "Phase: A, B, C … (the manufacturing phase). / Phase: A, B, C … (fase pembuatan)."],
      ["3", "Trade name: the product name of the raw material. / Nama dagang bahan baku."], ["4", "Nama bahan: the ingredient name in Indonesian. / Nama bahan dalam bahasa Indonesia."],
      ["5", "INCI name: the international name. For a blend, list all INCI names separated by commas. / Nama INCI: nama internasional. Untuk campuran, tulis semua nama INCI, dipisahkan koma."],
      ["6", "Supplier / maker: who makes the raw material. / Produsen bahan baku."], ["7", "Amount: numbers only, in the unit written in cell B5 (%, g or mL). If %, the total must be 100. / Jumlah: hanya angka, dalam satuan yang ditulis di sel B5 (%, g, atau mL). Jika %, total harus 100."],
      ["8", "Function (in English): e.g. Humectant, Emulsifier, Preservative. / Fungsi bahan (tulis dalam bahasa Inggris), mis. Humectant, Emulsifier, Preservative."], ["9", "Save the file and drop it into Formula Bridge (section B). / Simpan lalu unggah ke Formula Bridge (bagian B)."]]), "How to fill");
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
          <div class="pdf-m">Unit: ${unit === "%" ? "% w/w" : esc(unit) + " per batch (% calculated)"}　Date: ${new Date().toISOString().slice(0, 10)}　Page ${pg + 1}/${pages}</div></div><div class="pdf-brand">BIOT<br><span>Artisans Production Co., Ltd.</span></div></div>
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
          ${readOnly ? "" : `<td><button class="x" data-del="${i}" aria-label="Delete row">×</button></td>`}</tr>`).join("") || `<tr><td colspan="${cols.length + 2}" class="hint" style="padding:12px">No rows yet / Belum ada baris / まだ行がありません</td></tr>`}</tbody>
        ${pi >= 0 ? `<tfoot><tr><td colspan="${pi + 1}" style="text-align:right">Total</td><td class="num ${totalCheck && tk === "pct" ? (Math.abs(tot - 100) <= 0.01 ? "total-ok" : "total-bad") : ""}">${fmt(tot)}</td><td colspan="${cols.length - pi + (readOnly ? -1 : 0)}"></td></tr></tfoot>` : ""}`;
    };
    el.oninput = (e) => {
      const t = e.target; if (!t.dataset.k) return; const r = rows[+t.dataset.i]; if (!r) return;
      r[t.dataset.k] = t.value;
      if (cols.find((c) => c.k === t.dataset.k)?.req) t.classList.toggle("miss", !t.value.trim());
      if (["idName", "inci", "trade"].includes(t.dataset.k) && "ja" in r && cols.some((c) => c.ja)) { r.ja = ""; r.jaNote = ""; }
      const tk = cols.find((c) => c.total)?.k || "pct";
      onChange();
      if (t.dataset.k === tk) { const c = el.querySelector("tfoot td.num"); if (c) { const tot = rows.reduce((a, x) => a + num(x[tk]), 0); c.textContent = fmt(tot); if (totalCheck && tk === "pct") c.className = "num " + (Math.abs(tot - 100) <= 0.01 ? "total-ok" : "total-bad"); } }
    };
    el.onclick = (e) => {
      const b = e.target.closest("[data-del]"); if (!b) return;
      const i = +b.dataset.del, [gone] = rows.splice(i, 1); onChange(); render();
      toastAction("行を削除しました / Row deleted / Baris dihapus", "", "元に戻す / Undo / Batalkan", () => { rows.splice(i, 0, gone); onChange(); render(); });
    };
    el.onfocusout = () => setTimeout(render, 0);
    render();
    return { render, add() { rows.push({}); onChange(); render(); el.querySelector("tbody tr:last-child input")?.focus(); } };
  }

  /* Debounced save helper: one write at a time. */
  function saver(fn, st) {
    let t, chain = Promise.resolve(), pending = false;
    // run() returns a promise that rejects when the save fails (so "done" messages are not shown), while the chain
    // itself keeps going for the next save.
    let last = Promise.resolve(); const me = {};
    const run = () => { pending = false;
      last = chain.then(fn).then(() => { if (!pending) unsaved.delete(me); autosave("ok"); if (st) st.textContent = "Saved / Tersimpan / 保存しました " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }); },
        (e) => { pending = true; autosave("error"); console.error(e);
          const why = /adopted formula is locked/.test(e?.message || "") ? "This formula has been adopted by Japan and can no longer be changed. / Formula ini telah diadopsi oleh Jepang dan tidak dapat diubah lagi. / 採用・確定済みのため変更できません。" : (e?.message || e?.userMsg || "");
          if (st) st.textContent = "Could not save / Gagal menyimpan / 保存できませんでした";
          throw { userMsg: "Could not save / Gagal menyimpan / 保存できませんでした: " + why }; });
      chain = last.catch(() => {}); return last; };
    // Save now (used before signing out so the last edit is not lost).
    me.flush = () => { clearTimeout(t); return pending ? run().catch(() => {}) : last.catch(() => {}); };
    return { soon() { pending = true; unsaved.add(me); autosave("saving"); if (st) st.textContent = "Saving… / Menyimpan… / 保存中…"; clearTimeout(t); t = setTimeout(() => run().catch(() => {}), 1000); }, now() { clearTimeout(t); return pending ? run() : last; } };
  }

  /* Indonesian / trade names → Japanese label names (日本語表示名称) */
  async function convertToJapanese(rows) {
    const list = rows.map((r, i) => ({ i, trade: r.trade || "", idName: r.idName || "", inci: r.inci || "" })).filter((r) => r.trade || r.idName || r.inci);
    if (!list.length) throw { userMsg: "Enter at least one ingredient. / Isi minimal satu bahan. / 原料を1行以上入力してください。" };
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
  const PRODUCT_FIELDS = [["name", "Product name / Nama produk"], ["concept", "Concept / Konsep"], ["features", "Key features (one per line) / Fitur utama (satu per baris)"], ["claims", "Possible marketing claims / Klaim pemasaran"], ["appearance", "Appearance / texture / Tampilan / tekstur"], ["ph", "pH"], ["viscosity", "Viscosity / Viskositas"], ["shelfLife", "Shelf life / Masa simpan"], ["stability", "Stability test summary / Ringkasan uji stabilitas"], ["cost", "Your quote: raw material cost per unit / Penawaran Anda: biaya bahan baku per unit"], ["moq", "MOQ"], ["leadTime", "Lead time / Waktu tunggu"], ["process", "Manufacturing process / Proses pembuatan"]];
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
    if (error) { toast("Could not open file / Gagal membuka file / ファイルを開けませんでした", error.message, "info"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  /* ================= SUPPLIER (Indonesia) ================= */
  async function supplierHome() {
    const { data: rows, error } = await sb.from("assignments").select("id, status, request_snapshot, requested_at, submitted_at, shipped_at, feedback_at, updated_at").order("requested_at", { ascending: false });
    app.innerHTML = `${S.company && !S.company.logo_path ? `<div class="notice off en"><b>Please upload your company logo (JPG).</b> Japan uses it to tell suppliers apart. / Harap unggah logo perusahaan Anda (JPG). Jepang menggunakannya untuk membedakan pemasok. <a href="#/company">Company profile / Profil perusahaan →</a></div>` : ""}<div class="who id">${FLAG_ID}${esc(S.company?.name || "")} — requests from Japan<small>Permintaan dari Jepang · Only your company can see these. / Hanya perusahaan Anda yang dapat melihatnya.</small></div>
      <div class="card en"><h2>Requests / Permintaan</h2>
      ${error ? `<p class="status err">${esc(error.message)}</p>` : (rows || []).length ? `<div class="tbl-wrap"><table class="view master"><thead><tr><th>Project / Proyek</th><th>Received / Diterima</th><th>Status</th><th>Submitted / Diajukan</th><th>Sample shipped / Sampel dikirim</th><th>Feedback / Umpan balik</th><th></th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td>${esc(a.request_snapshot?.name || "(project)")}</td><td>${d(a.requested_at)}</td><td>${chip(a.status, true)}</td><td>${d(a.submitted_at)}</td><td>${a.shipped_at ? '<span class="chip done">Shipped / Terkirim ✓</span>' : "—"}</td><td>${a.feedback_at ? '<span class="chip done">Received / Diterima ✓</span>' : "—"}</td><td><a href="#/a/${a.id}">Open / Buka →</a></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No requests yet. You will receive an email when Japan sends one.<br>Belum ada permintaan. Anda akan menerima email saat Jepang mengirim permintaan.</div>`}
      </div>`;
  }

  function chip(status, en) {
    const L = { draft: ["下書き", "Draft"], requested: ["依頼済み", "New request / Baru"], developing: ["開発中", "In progress / Dalam proses"], submitted: ["提出済み ✓", "Submitted / Diajukan ✓"] }[status] || [status, status];
    return `<span class="chip ${esc(status)}">${esc(en ? L[1] : L[0])}</span>`;
  }

  async function supplierAssignment(aid) {
    const { data: a, error } = await sb.from("assignments").select("*").eq("id", aid).maybeSingle();
    if (error || !a) { app.innerHTML = `<div class="card"><p>This request was not found, or it is not addressed to your company. / Permintaan ini tidak ditemukan atau tidak ditujukan kepada perusahaan Anda.</p><a href="#/">← Back / Kembali</a></div>`; return; }
    const sp = Object.assign({ product: {}, formula: [], materials: [], tests: [], files: [] }, a.supplier || {});
    const snap = a.request_snapshot || {}, rq = snap.request || {};
    await loadLogos([S.company]);
    app.innerHTML = `<div class="who id ${a.status === "submitted" ? "is-done" : ""}">${FLAG_ID}Your company fills in this page · Diisi oleh perusahaan Anda<small>Please write in English / Harap tulis dalam bahasa Inggris</small><span class="state">${a.status === "submitted" ? "Done / Selesai ✓" : "In progress / Dalam proses"}</span></div>
    <div class="progress en" id="progress" aria-label="Progress / Kemajuan"></div>
    <div class="stack en">
      ${a.feedback_at ? `<div class="card" style="border-color:var(--ok)"><h2>${FLAG_JP}Feedback from Japan / Umpan balik dari Jepang</h2>
        <p class="sub">${dt(a.feedback_at)} · <b>${esc(a.feedback?.decision_en || "")}</b>${(() => { const x = a.feedback?.decision_id || (FB_DECISIONS.find(([j]) => j === a.feedback?.decision) || [])[2]; return x ? ` / <b>${esc(x)}</b>` : ""; })()}</p>
        <div class="brief-out">${esc(a.feedback?.en || "")}</div><div class="brief-out" style="margin-top:8px">${esc(a.feedback?.id || "")}</div></div>` : ""}
      <div class="card"><div class="head"><div><h2>${FLAG_JP}Request from Japan / Permintaan dari Jepang: ${esc(snap.name || "")}</h2>${rq.requester ? `<p class="sub" style="margin:0">Requested by / Diminta oleh: <b>${esc(rq.requester)}</b> (Artisans Production Co., Ltd.)</p>` : ""}</div>
        <div class="seg"><button type="button" data-rq="en" aria-pressed="true">English</button><button type="button" data-rq="id" aria-pressed="false">Bahasa Indonesia</button></div></div>
        <div class="brief-out" id="dev-brief"></div></div>
      <div class="card"><h2>${FLAG_ID}A. Product overview / Ringkasan produk</h2><p class="sub">Changes are saved automatically. / Perubahan tersimpan otomatis. <span class="saved" id="saved"></span></p>
        <div class="targets"><div><span>${FLAG_JP}Target raw material cost / unit · Target biaya bahan baku / unit</span><b>${esc(rq.costRaw || "—")}</b></div><div><span>${FLAG_JP}Target finished product cost / unit · Target biaya produk jadi / unit</span><b>${esc(rq.costFin || "—")}</b></div><div><span>${FLAG_JP}Planned retail price (incl. tax) · Rencana harga jual (termasuk pajak)</span><b>${esc(rq.price || "—")}</b></div></div>
        <div id="prod-fields"></div></div>
      <div class="card"><div class="head"><div><h2>${FLAG_ID}B. Base formula / Formula dasar</h2><p class="sub" style="margin:0">One row per raw material. Enter the Indonesian ingredient name (Nama bahan) and the amount. Then press “Convert to Japanese names” to fill in the Japanese names. / Satu baris per bahan baku. Isi Nama bahan dan jumlahnya, lalu tekan “Konversi ke nama Jepang” untuk mengisi nama Jepang secara otomatis.</p></div>
        <div class="to-ja-wrap"><span class="next-tag" id="to-ja-tag" hidden>Next step / Langkah berikutnya</span><button class="btn ghost" id="to-ja">Convert to Japanese names / Konversi ke nama Jepang / 日本語表示名称に変換</button></div></div>
        <div class="tpl-box"><div><b>① Download our formula template (Excel), fill in every cell, then ② drop it in the box below.</b>
          <span>A PDF in your lab's own format is also OK — any empty cells must then be filled in here. / Unduh template formula kami (Excel), isi semua sel, lalu letakkan file di kotak di bawah. PDF dengan format lab Anda sendiri juga boleh — sel yang kosong harus diisi di sini.</span></div>
          <button type="button" class="btn saff" id="tpl-dl">Formula template (Excel) / Template formula</button></div>
        <div class="drop" id="f-drop" tabindex="0" role="button" aria-label="Import formula from a file">
          <b>Drop your formula file here, or tap to choose / Letakkan file formula di sini atau ketuk untuk memilih</b>
          <span>PDF, Excel (.xlsx / .xls), CSV or a photo — the table below is filled in automatically.</span>
          <span>PDF, Excel, CSV atau foto — tabel di bawah akan terisi otomatis. / 処方ファイルをここにドロップすると自動で入力されます。</span>
          <input type="file" id="f-drop-in" accept=".pdf,.xlsx,.xls,.csv,image/jpeg,image/png,image/webp" hidden></div>
        <div class="status" id="st-drop" role="status" aria-live="polite"></div><div id="drop-preview"></div>
        <div class="field" style="max-width:340px"><label for="f-unit">Amount unit / Satuan jumlah</label><select id="f-unit"><option value="%">% w/w (total 100%)</option><option value="g">g per batch (% is calculated) / g per batch (% dihitung otomatis)</option><option value="mL">mL per batch (% is calculated) / mL per batch (% dihitung otomatis)</option></select></div>
        <div class="tbl-wrap"><table class="edit" id="t-formula"></table></div>
        <div class="status err" id="st-miss" role="status"></div>
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="add-formula">＋ Add row / Tambah baris</button><span class="spacer"></span>
          <span class="muted" style="font-size:12.5px">Save the formula as / Simpan sebagai:</span><button type="button" class="btn ghost" id="f-xlsx">Excel</button><button type="button" class="btn ghost" id="f-pdf">PDF</button></div>
        <p class="sub" style="margin:6px 0 0">When you submit, the formula is also sent to Japan as Excel and PDF automatically. / Saat Anda menekan Submit, formula juga otomatis dikirim ke Jepang dalam format Excel dan PDF.</p>
        <div class="status" id="st-toja"></div></div>
      <div class="card"><h2>${FLAG_ID}C. Raw material highlights / Keunggulan bahan baku</h2><p class="sub">Features of key raw materials and your data (efficacy, mechanism, dosage). Attach graphs in section E. / Keunggulan bahan baku utama dan data Anda (efikasi, mekanisme, dosis). Lampirkan grafik di bagian E.</p>
        <div class="tbl-wrap"><table class="edit" id="t-materials"></table></div><div class="row" style="margin-top:8px"><button class="btn ghost" id="add-materials">＋ Add row / Tambah baris</button></div></div>
      <div class="card"><h2>${FLAG_ID}D. Third-party test data / Data uji pihak ketiga</h2><p class="sub">Tests by independent laboratories (patch test, efficacy, stability, microbiology…). Attach reports in section E. / Uji oleh laboratorium independen (uji tempel, efikasi, stabilitas, mikrobiologi…). Lampirkan laporan di bagian E.</p>
        <div class="tbl-wrap"><table class="edit" id="t-tests"></table></div><div class="row" style="margin-top:8px"><button class="btn ghost" id="add-tests">＋ Add row / Tambah baris</button></div></div>
      <div class="card"><h2>${FLAG_ID}E. Attachments / Lampiran</h2><p class="sub">Data sheets, graphs, specifications, sales materials, third-party reports, SDS, COA (max 25 MB each). / Lembar data, grafik, spesifikasi, materi penjualan, laporan pihak ketiga, SDS, COA (maks. 25 MB per file).</p>
        <div class="files" id="files"></div>
        <div class="upl"><div class="field" style="margin:0"><label for="f-cat">Category / Kategori</label><select id="f-cat"><option value="Raw material data">Raw material data / Data bahan baku</option><option value="Graph / chart">Graph / chart / Grafik</option><option value="Specification">Specification / Spesifikasi</option><option value="Sales material">Sales material / Materi penjualan</option><option value="Third-party report">Third-party report / Laporan pihak ketiga</option><option value="SDS">SDS</option><option value="COA">COA</option><option value="Other">Other / Lainnya</option></select></div>
          <div class="field" style="margin:0"><label for="f-desc">Description / Keterangan</label><input id="f-desc" placeholder="e.g. Hydration graph, 4 weeks, n=20"></div>
          <label class="btn saff" style="position:relative">Upload file / Unggah file<input type="file" id="f-file" multiple style="position:absolute;width:1px;height:1px;opacity:0"></label></div>
        <div class="status" id="st-upl"></div></div>
      <div class="card"><h2>${FLAG_ID}Submit to Japan / Kirim ke Jepang</h2><p class="sub">When the sample is ready and A–E are complete, press Submit. Japan's development team is notified by email. / Setelah sampel siap dan bagian A–E lengkap, tekan Submit. Tim pengembangan Jepang akan diberi tahu melalui email.</p>
        <div class="row"><button class="btn saff big" id="submit">Submit to Japan / Kirim ke Jepang</button><span class="spacer"></span>
          </div>
        <div class="status" id="st-submit"></div></div>
      <div class="card" id="ship-card"><h2>${FLAG_ID}F. Sample shipment to Japan / Pengiriman sampel</h2>
        <p class="sub">After submitting, send the sample to Japan and enter the tracking number. Press "Shipment complete" — Japan's development team is emailed automatically. / Setelah mengirim data, kirim sampel ke Jepang dan isi nomor resi. Tekan "Pengiriman selesai" — tim pengembangan Jepang akan menerima email otomatis.</p>
        <div class="grid2">
          <div class="field"><label for="s-carrier">Courier / Kurir</label><select id="s-carrier"><option></option><option>DHL</option><option>FedEx</option><option>UPS</option><option>EMS (Pos Indonesia)</option><option>JNE</option><option value="Other">Other / Lainnya</option></select></div>
          <div class="field"><label for="s-tracking">Tracking number / Nomor resi *</label><input id="s-tracking"></div>
          <div class="field"><label for="s-date">Ship date / Tanggal kirim</label><input id="s-date" type="date"></div>
          <div class="field"><label for="s-qty">Samples / Jumlah sampel</label><div class="num-unit"><input id="s-qty" inputmode="decimal" placeholder="e.g. 3"><select id="s-qtyu" aria-label="unit"><option value="pcs">pcs / buah</option><option value="bottles">bottles / botol</option><option>mL</option><option>g</option><option>kg</option><option>L</option></select></div></div>
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
      refreshProgress();
    }, $("saved"));
    // What is done and what is still missing, at the top of the page.
    function refreshProgress() {
      const el = $("progress"); if (!el) return;
      const tot = sp.formula.reduce((x, r) => x + num(r.pct), 0);
      const items = [
        ["A", "Product overview", "Ringkasan produk", !!sp.product?.name],
        ["B", "Formula — 100%, no empty cells", "Formula — 100%, tanpa sel kosong", sp.formula.length > 0 && Math.abs(tot - 100) <= 0.01 && !blanks().length],
        ["E", "Attachments", "Lampiran", sp.files.some((f) => !f.auto)],
        ["✓", "Submitted to Japan", "Diajukan ke Jepang", status === "submitted"],
        ["F", "Sample shipped", "Sampel dikirim", !!a.shipped_at],
      ];
      el.innerHTML = items.map(([k, en, id, ok]) => `<div class="pg ${ok ? "ok" : ""}"><span class="pg-k">${k}</span><span class="pg-l">${en}<small>${id}</small></span><span class="pg-s">${ok ? "Done / Selesai" : "To do / Belum"}</span></div>`).join("");
    }

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
      : COLS.formula.flatMap((c) => c.k === "pct" ? [{ k: "amt", l: `Amount (${sp.formulaUnit}) per batch / Jumlah (${sp.formulaUnit}) per batch`, w: 110, num: true, total: true, req: true, ph: "e.g. 25" }, { k: "pct", l: "% w/w (auto) / % b/b (otomatis)", w: 90, num: true, ro: true }] : [c]);
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
      $("st-miss").textContent = n ? `${n} empty cell${n > 1 ? "s" : ""} (highlighted in yellow) — please fill in every cell before submitting. / ${n} sel kosong (kuning) — harap isi semua sel sebelum mengirim.` : "";
      const next = !n && needsJa();
      $("to-ja").classList.toggle("next", next); $("to-ja").classList.toggle("ghost", !next); $("to-ja-tag").hidden = !next;
      refreshProgress();
    };
    const mountFormula = () => { tF = editTable($("t-formula"), formulaCols(), sp.formula, () => { recalcPct(); save.soon(); refreshCues(); }, { totalCheck: true }); refreshCues(); };
    $("f-unit").value = sp.formulaUnit;
    $("f-unit").onchange = () => {
      const prev = sp.formulaUnit; sp.formulaUnit = $("f-unit").value;
      if (sp.formulaUnit !== "%" && prev === "%") sp.formula.forEach((r) => (r.amt = r.pct || r.amt || ""));
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
      return old; // removed from storage only after the submission is saved
    };
    $("tpl-dl").onclick = async () => {
      download(fileBase(snap.name, "formula_template") + ".xlsx", await formulaXlsx({ project: snap.name, company: S.company?.name, unit: "%", rows: [] }));
      toast("Template downloaded ✓ / Template diunduh ✓", "Fill in every cell, save, then drop the file in the dashed box below. / Isi semua sel, simpan, lalu letakkan file di kotak bergaris putus-putus di bawah.", "info");
    };
    // Our own template is read directly (exact, instant); anything else goes to the AI.
    const readTemplate = (XLSX, wb) => {
      const ws = wb.Sheets.Formula; if (!ws) return null;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      if (String(rows[0]?.[0] || "").trim() !== TPL_MARK) return null;
      const u = rows.find((r) => /^Amount unit/i.test(String(r[0] || "")))?.[1];
      const uu = String(u || "%").trim().toLowerCase();
      const unit = /^g(r|ram|rams|ramm?e?)?s?$/.test(uu) ? "g" : /^(ml|mililiter|milliliters?|millilitres?)$/.test(uu) ? "mL" : "%";
      const h = rows.findIndex((r) => String(r[0] || "").trim() === "No." && /^Phase/.test(String(r[1] || "")));
      if (h < 0) return null;
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
      if (!isPdf && !isSheet && !isImg) { dropSt.className = "status err"; dropSt.textContent = "Please use a PDF, Excel (.xlsx/.xls), CSV, JPG or PNG file. / Gunakan file PDF, Excel, CSV, JPG, atau PNG."; return; }
      if (file.size > 10 * 1024 * 1024) { dropSt.className = "status err"; dropSt.textContent = "The file is larger than 10 MB. Please send a smaller file. / File lebih dari 10 MB. Kirim file yang lebih kecil."; return; }
      drop.classList.add("busy"); dropSt.textContent = `Reading ${file.name}… (20–60 seconds) / Membaca file… (20–60 detik)`; $("drop-preview").innerHTML = "";
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
- Fields per row: phase (e.g. A/B/C), trade (trade name), idName (Indonesian ingredient name / Nama bahan), inci (INCI name), maker (supplier or manufacturer), amt (the amount as written, number only), fn (function, only if shown).
- unit: "%" if the amounts are percentages (w/w) or add up to about 100; "g" if grams; "mL" if millilitres.
- notes: anything unclear or unreadable, in English, short. "" if none.
Reply with JSON only: {"unit":"%","items":[{"phase":"","trade":"","idName":"","inci":"","maker":"","amt":"","fn":""}],"notes":""}`, opts);
        const items = (Array.isArray(res.items) ? res.items : []).filter((x) => x && (x.trade || x.idName || x.inci));
        if (!items.length) throw { userMsg: "No formula rows were found in this file. Please check the file or enter the rows by hand. / Tidak ada baris formula dalam file ini. Periksa file atau isi baris secara manual." };
        const unit = ["%", "g", "mL"].includes(res.unit) ? res.unit : "%";
        const tot = items.reduce((a, x) => a + num(x.amt), 0);
        const F7 = ["phase", "trade", "idName", "inci", "maker", "amt", "fn"], empty = items.reduce((a, x) => a + F7.filter((k) => !String(x[k] ?? "").trim()).length, 0);
        dropSt.textContent = `✓ ${items.length} rows found (${unit === "%" ? `total ${fmt(tot)}%` : `total ${fmt(tot)} ${unit}`}). Please check them, then press "Use these rows". / ${items.length} baris ditemukan — periksa, lalu tekan "Gunakan baris ini".` + (empty ? ` ${empty} empty cell${empty > 1 ? "s" : ""} (yellow) must be filled in after importing. / ${empty} sel kosong (kuning) harus diisi setelah impor.` : "");
        $("drop-preview").innerHTML = `<div class="confirm-box">${res.notes ? `<div class="status err" style="margin:0">Note: ${esc(res.notes)}</div>` : ""}
          <div class="tbl-wrap"><table class="view"><thead><tr><th>No.</th><th>Phase</th><th>Trade name</th><th>Nama bahan</th><th>INCI</th><th>Maker</th><th>Amount (${esc(unit)})</th><th>Function</th></tr></thead><tbody>
          ${items.map((x, i) => `<tr><td class="no">${i + 1}</td>${F7.map((k) => `<td class="${k === "inci" ? "inci " : k === "amt" ? "num " : ""}${String(x[k] ?? "").trim() ? "" : "miss"}">${esc(x[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <div class="row"><button type="button" class="btn saff" id="imp-replace">Use these rows / Gunakan baris ini${sp.formula.length ? " (replace current table / ganti tabel)" : ""}</button>
          ${sp.formula.length ? '<button type="button" class="btn ghost" id="imp-append">Add below current rows / Tambahkan di bawah</button>' : ""}<button type="button" class="btn ghost" id="imp-cancel">Cancel / Batal</button></div></div>`;
        const apply = (replace) => {
          const rows = items.map((x) => ({ phase: String(x.phase || ""), trade: String(x.trade || ""), idName: String(x.idName || ""), inci: String(x.inci || ""), maker: String(x.maker || ""), fn: String(x.fn || ""), ...(unit === "%" ? { pct: String(x.amt || "") } : { amt: String(x.amt || "") }) }));
          if (replace) { sp.formula.splice(0, sp.formula.length, ...rows); sp.formulaUnit = unit; }
          else { if (sp.formulaUnit !== unit) { dropSt.className = "status err"; dropSt.textContent = `The file uses "${unit}" but the table uses "${sp.formulaUnit}". Please replace the table instead. / Satuan file berbeda dengan tabel — ganti tabel.`; return; } sp.formula.push(...rows); }
          $("f-unit").value = sp.formulaUnit; recalcPct(); $("t-formula").innerHTML = ""; mountFormula(); save.soon();
          $("drop-preview").innerHTML = ""; const nb = blanks().length;
          dropSt.textContent = nb ? `✓ ${rows.length} rows added. Next, fill in the empty (yellow) cells, then press "Convert to Japanese names" (top right). / Isi sel kosong (kuning), lalu tekan "Konversi ke nama Jepang" (kanan atas).` : `✓ ${rows.length} rows added. Next, press "Convert to Japanese names" (top right, highlighted). / Selanjutnya tekan "Konversi ke nama Jepang" (kanan atas).`;
          $("to-ja").scrollIntoView({ behavior: "smooth", block: "center" });
          toast("Formula imported ✓ / Formula diimpor ✓", `${rows.length} rows / baris`);
        };
        $("imp-replace").onclick = () => apply(true);
        if ($("imp-append")) $("imp-append").onclick = () => apply(false);
        $("imp-cancel").onclick = () => { $("drop-preview").innerHTML = ""; dropSt.textContent = ""; };
      } catch (e) {
        dropSt.className = "status err"; dropSt.textContent = e?.userMsg || "The file could not be read. Please try again or enter the rows by hand. / File tidak dapat dibaca. Coba lagi atau isi baris secara manual.";
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
    $("to-ja").onclick = (e) => busy(e.currentTarget, $("st-toja"), "Converting… / Mengonversi… / 変換しています…", async () => {
      const n = await convertToJapanese(sp.formula); $("t-formula").innerHTML = ""; mountFormula(); save.soon(); await save.now();
      $("st-toja").textContent = `✓ ${n} rows converted. Japan will check the notes column (確認事項). / ${n} baris telah dikonversi. Jepang akan memeriksa kolom catatan (確認事項).`;
    });

    const renderFiles = () => {
      queueMicrotask(refreshProgress);
      $("files").innerHTML = sp.files.length ? sp.files.map((f, i) => `<div class="file"><span class="cat">${esc(f.cat)}</span><div><button class="linkbtn" data-open="${i}">${esc(f.name)}</button>${f.desc ? `<div class="d">${esc(f.desc)}</div>` : ""}</div><button class="x" data-rm="${i}" aria-label="Remove">×</button></div>`).join("") : `<div class="hint">No files yet. / Belum ada file.</div>`;
    };
    $("files").onclick = async (e) => {
      const o = e.target.closest("[data-open]"), r = e.target.closest("[data-rm]");
      if (o) openFile(sp.files[+o.dataset.open].path);
      if (r) {
        const f0 = sp.files[+r.dataset.rm];
        if (!(await confirmModal({ title: "Delete this file? / Hapus file ini?", body: `<p>${esc(f0?.name || "")}</p><p class="sub">This cannot be undone. / Tindakan ini tidak dapat dibatalkan.</p>`, ok: "Delete / Hapus", tone: "danger" }))) return;
        const f = sp.files.splice(+r.dataset.rm, 1)[0]; renderFiles(); save.soon(); if (f) await sb.storage.from("attachments").remove([f.path]);
      }
    };
    renderFiles();
    $("f-file").onchange = async (e) => {
      const files = [...(e.target.files || [])]; e.target.value = ""; const st = $("st-upl");
      for (const f of files) {
        st.className = "status"; st.textContent = `Uploading / Mengunggah ${f.name}…`;
        const path = `${a.company_id}/${aid}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error } = await sb.storage.from("attachments").upload(path, f, { contentType: f.type || undefined });
        if (error) { st.className = "status err"; st.textContent = `${f.name}: upload failed / gagal diunggah (${error.message})`; continue; }
        sp.files.push({ path, name: f.name, cat: $("f-cat").value, desc: $("f-desc").value.trim(), type: f.type, size: f.size });
        renderFiles(); save.soon(); await save.now(); st.textContent = `Uploaded / Terunggah: ${f.name}`;
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
      $("st-ship").textContent = a.shipped_at ? `✓ Shipped / Terkirim: ${dt(a.shipped_at)} (tracking / resi ${sh.tracking || ""})` : ok ? "" : "Submit sections A–E first. / Kirim bagian A–E terlebih dahulu.";
      refreshProgress();
    };
    shipState();
    $("ship").onclick = (e) => busy(e.currentTarget, $("st-ship"), "Sending… / Mengirim…", async () => {
      SH.forEach((k) => (sh[k] = $("s-" + k).value.trim()));
      if (sh.qty) sh.qty = `${sh.qty} ${$("s-qtyu").value}`;
      if (!sh.tracking) throw { userMsg: "Please enter the tracking number. / Harap isi nomor resi." };
      await ask({ title: "Report the shipment to Japan? / Laporkan pengiriman ke Jepang?", ok: "Yes, report / Ya, laporkan", tone: "saff",
        body: kvHtml([["Courier / Kurir", sh.carrier], ["Tracking number / Nomor resi", sh.tracking], ["Ship date / Tanggal kirim", sh.date], ["Samples / Jumlah sampel", sh.qty]]) + "<p class=\"sub\">Japan's development team will be emailed. Please check the tracking number. / Tim pengembangan Jepang akan menerima email. Periksa kembali nomor resi.</p>" });
      const { data: up, error } = await sb.from("assignments").update({ shipment: sh, shipped_at: new Date().toISOString() }).eq("id", aid).select("shipped_at").single();
      if (error) throw { userMsg: "Could not save / Gagal menyimpan: " + error.message };
      a.shipped_at = up.shipped_at; a.shipment = sh;
      const { data: r } = await sb.functions.invoke("notify", { body: { event: "shipped", assignment_id: aid } });
      shipState();
      toast("Done: shipment reported ✓ / Selesai: pengiriman dilaporkan ✓", r?.sent ? "Japan's development team has been emailed with the tracking number. / Tim pengembangan Jepang telah menerima email beserta nomor resi." : "Japan will see it on the master screen. / Jepang akan melihatnya di layar utama.");
    });

    $("submit").onclick = (e) => busy(e.currentTarget, $("st-submit"), "Submitting… / Mengirim…", async () => {
      const miss = [], tot = sp.formula.reduce((x, r) => x + num(r.pct), 0);
      if (!sp.product.name) miss.push("Product name / Nama produk");
      if (!sp.formula.length) miss.push("Formula (empty / kosong)");
      else if (Math.abs(tot - 100) > 0.01) miss.push(sp.formulaUnit === "%" ? `Formula total is ${fmt(tot)}% (must be 100%) / Total formula ${fmt(tot)}% (harus 100%)` : "Formula amounts / Jumlah formula");
      const b = blanks(); if (b.length) miss.push("Empty cells in the formula / Sel kosong dalam formula — " + b.slice(0, 5).map((x) => `row / baris ${x.i + 1}: ${x.m.join(", ")}`).join("; ") + (b.length > 5 ? " …" : ""));
      if (miss.length) throw { userMsg: "Please check / Harap periksa: " + miss.join(", ") };
      await ask({ title: "Submit to Japan? / Kirim ke Jepang?", ok: "Yes, submit / Ya, kirim", tone: "saff",
        body: kvHtml([["Product / Produk", sp.product.name], ["Formula / Formula", `${sp.formula.length} rows / baris · total ${fmt(tot)}%`], ["Attachments / Lampiran", `${sp.files.filter((f) => !f.auto).length}`]])
          + "<p class=\"sub\">Japan's development team will be emailed with the formula as Excel and PDF. You can still correct the page until Japan adopts a formula. / Tim pengembangan Jepang akan menerima email beserta formula (Excel dan PDF). Anda masih dapat memperbaiki halaman ini sampai Jepang mengadopsi formula.</p>" });
      if (needsJa()) {
        $("st-submit").textContent = "Converting to Japanese names first… / Mengonversi ke nama Jepang… / 日本語表示名称に変換しています…";
        // The AI being unavailable must not block the submission: Japan can convert later in STEP 2.
        try { await convertToJapanese(sp.formula); $("t-formula").innerHTML = ""; mountFormula(); } catch (err) { console.error(err); }
      }
      $("st-submit").textContent = "Making the formula Excel + PDF… / Membuat Excel + PDF…";
      let fileNote = "", oldAuto = [];
      try { oldAuto = await attachFormulaFiles(); } catch (err) { console.error(err); fileNote = " (The Excel/PDF copy could not be attached; Japan can still see the formula. / Salinan Excel/PDF tidak dapat dilampirkan; Jepang tetap dapat melihat formula.)"; }
      $("st-submit").textContent = "Submitting… / Mengirim…";
      await save.now();
      const { error } = await sb.from("assignments").update({ supplier: sp, status: "submitted" }).eq("id", aid);
      if (error) throw { userMsg: "Could not submit / Gagal mengirim: " + error.message };
      status = "submitted";
      if (oldAuto.length) sb.storage.from("attachments").remove(oldAuto.map((f) => f.path));
      const { data: r } = await sb.functions.invoke("notify", { body: { event: "submit", assignment_id: aid } });
      $("st-submit").className = "status"; $("st-submit").textContent = "✓ Done: submitted to Japan. / Selesai: diajukan ke Jepang." + (r?.sent ? " Japan has been emailed (with the formula Excel + PDF). / Jepang telah menerima email (dengan Excel + PDF formula)." : "") + fileNote;
      shipState(); $("ship-card").scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Done: submitted to Japan ✓ / Selesai: diajukan ke Jepang ✓", r?.sent ? "Japan's development team has been notified by email. / Tim pengembangan Jepang telah diberi tahu melalui email. Terima kasih!" : "Japan will see it on the master screen. / Jepang akan melihatnya di layar utama. Terima kasih!");
      document.querySelector(".who").classList.add("is-done"); document.querySelector(".who .state").textContent = "Done / Selesai ✓";
    });

  }

  async function supplierCompany() {
    const c = S.company;
    if (!c) { app.innerHTML = `<div class="card en">Your account is not linked to a company yet. Please contact Artisans Production. / Akun Anda belum terhubung dengan perusahaan. Silakan hubungi Artisans Production.</div>`; return; }
    await loadLogos([c]);
    // Company name and contact email are managed by Japan (the confidential requests are sent there).
    const RO = [["name", "Company name / Nama perusahaan"], ["contact_email", "Contact email / Email kontak"]];
    const F = [["contact_name", "Contact person / Nama kontak"], ["phone", "Phone / Telepon"], ["whatsapp", "WhatsApp"], ["address", "Company address / Alamat perusahaan"], ["website", "Website / Situs web"],
      ["nib", "Business ID (NIB) / Nomor Induk Berusaha (NIB)"], ["halal", "Halal certification / Sertifikasi halal"], ["materials", "Main raw materials you supply / Bahan baku utama yang Anda pasok"]];
    app.innerHTML = `<div class="who id">${FLAG_ID}Company profile / Profil perusahaan</div><form class="card en" id="f-co">
      ${RO.map(([k, l]) => `<div class="field"><label>${l}</label><div class="ro-box" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--ground)">${esc(c[k] || "—")}</div></div>`).join("")}
      <p class="sub">To change these two, please contact Artisans Production. / Untuk mengubah keduanya, silakan hubungi Artisans Production.</p>
      ${F.map(([k, l]) => `<div class="field"><label for="c-${k}">${l}</label><input id="c-${k}" value="${esc(c[k] || "")}"></div>`).join("")}
      <div class="field"><label for="c-logo">Company logo (JPG) / Logo perusahaan (JPG) *</label><div class="logo-in">${logoImg(c, 72)}<input id="c-logo" type="file" accept="image/jpeg,image/png"><span id="c-logo-prev"></span></div><div class="status" id="st-logo"></div></div>
      <p class="sub">NDA agreed / NDA disetujui: ${dt(c.nda_agreed_at)}</p><button class="btn" type="submit">Save / Simpan</button><div class="status" id="st-co"></div></form>`;
    $("c-logo").onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return; const st = $("st-logo"); st.className = "status"; st.textContent = "Uploading… / Mengunggah…";
      try { await uploadLogo(c, f); st.textContent = "✓ Logo saved / Logo tersimpan"; supplierCompany(); } catch (err) { st.className = "status err"; st.textContent = err?.userMsg || "Upload failed / Gagal mengunggah"; }
    };
    $("f-co").onsubmit = async (e) => {
      e.preventDefault(); const patch = {}; F.forEach(([k]) => (patch[k] = $("c-" + k).value.trim()));
      const { error } = await sb.from("companies").update(patch).eq("id", c.id);
      $("st-co").className = error ? "status err" : "status";
      $("st-co").textContent = error ? "Could not save / Gagal menyimpan: " + error.message : "Saved ✓ / Tersimpan ✓"; if (!error) Object.assign(c, patch);
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
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw { userMsg: "JPG（または PNG）の画像を選んでください。 / Please choose a JPG or PNG image. / Pilih gambar JPG atau PNG." };
    if (file.size > 8 * 1024 * 1024) throw { userMsg: "画像が大きすぎます（8MBまで）。 / The image is larger than 8 MB. / Ukuran gambar melebihi 8 MB." };
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
    if (error) throw { userMsg: "ロゴをアップロードできませんでした / Upload failed / Gagal mengunggah: " + error.message };
    const { error: e2 } = await sb.from("companies").update({ logo_path: path }).eq("id", company.id);
    if (e2) throw { userMsg: "ロゴを保存できませんでした / Could not save / Gagal menyimpan: " + e2.message };
    if (company.logo_path && company.logo_path.startsWith(company.id + "/logo/")) sb.storage.from("attachments").remove([company.logo_path]);
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
    // A finalized formula decides first (only one company can be adopted per project); otherwise the feedback decision.
    if (f?.finalized_at && f.adopted_assignment === a.id) return { k: "yes", at: f.finalized_at, why: "完成処方に採用" };
    if (f?.finalized_at && f.adopted_assignment) return { k: "no", at: f.finalized_at, why: "他社の処方を採用" };
    if (dec.startsWith("採用（")) return { k: "yes", at: a.feedback_at, why: "フィードバックで採用" };
    if (dec === "不採用") return { k: "no", at: a.feedback_at, why: a.feedback?.ja || "不採用" };
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
        <div class="kpi" style="border:0;padding:10px 0 0"><div class="nums"><div><b>${list.length}</b>依頼</div><div><b>${cnt((x) => ["requested", "developing"].includes(x.a.status))}</b>開発中</div><div><b>${cnt((x) => x.a.status === "submitted")}</b>提出済み</div><div><b style="${cnt((x) => needsFeedback(x.a)) ? "color:var(--warn)" : ""}">${cnt((x) => needsFeedback(x.a))}</b>FB未実施</div><div><b style="color:var(--ok)">${cnt((x) => x.o?.k === "yes")}</b>採用</div><div><b>${cnt((x) => x.o?.k === "no")}</b>不採用</div></div></div></div>
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
      ${owed.length ? `<div class="notice off"><b>FB（フィードバック）未実施 ${owed.length}件</b>　サンプルが届いた会社には必ずフィードバックを送ってください：${owed.map(({ p, a }) => `<a href="#/p/${p.id}/dev">${esc(coName(a.company_id))}（${esc(p.name)}）</a>`).join("、")}</div>` : ""}
      <div class="head"><h2 style="margin:0">登録企業 ${S.companies.length}社</h2><button class="btn" id="new-proj">＋ 新規案件</button></div>
      <div class="kpis">${stats.map(({ c, req, dev, sub, fb }) => `<a class="kpi kpi-link" href="#/co/${c.id}" title="${esc(c.name)} の案件一覧を見る"><div class="co">${logoImg(c, 40)}<span>${esc(c.name)}</span><span class="kpi-go">案件一覧 ›</span></div>
        <div class="nums"><div><b>${req}</b>依頼</div><div><b>${dev}</b>開発中</div><div><b>${sub}</b>提出済み</div><div><b style="${fb ? "color:var(--warn)" : ""}">${fb}</b>FB未実施</div></div>
        <div class="muted" style="font-size:12px">${esc(c.contact_name || "")}　${esc(c.contact_email || "")}</div></a>`).join("") || `<div class="kpi"><div class="muted">まだ登録企業がありません。「登録企業」画面から仕入先を登録し、ログイン情報を送ってください。</div></div>`}</div>
      <div class="card"><h2>${FLAG_JP}案件一覧</h2><div class="tbl-wrap" style="margin-top:10px"><table class="view master"><thead><tr><th>案件</th><th>依頼先と進捗</th><th>完成処方</th><th>企画書</th><th>更新</th></tr></thead><tbody>
      ${listP.map((p) => { const as = openAs(p), nd = (p.assignments || []).filter((a) => a.status !== "draft").length - as.length, f = one(p.finals), pl = one(p.plans);
        return `<tr><td><a href="#/p/${p.id}">${esc(p.name)}</a><div class="muted" style="font-size:12px">${esc(p.request?.cat || "")}</div></td>
        <td>${as.length ? as.map((a) => `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:3px 0">${logoImg(S.companies.find((c) => c.id === a.company_id), 30)}<span>${esc(coName(a.company_id))}</span>${chip(a.status)}${a.shipped_at ? '<span class="chip done">発送済み</span>' : ""}${a.feedback_at ? '<span class="chip done">FB済み</span>' : needsFeedback(a) ? '<span class="chip" style="border-color:var(--warn);color:var(--warn)">FB未実施</span>' : ""}<span class="muted" style="font-size:11px">${a.submitted_at ? "提出 " + d(a.submitted_at) : "依頼 " + d(a.requested_at)}</span></div>`).join("") : '<span class="chip draft">未依頼</span>'}${nd ? `<div class="muted" style="font-size:11.5px;margin-top:2px">採用・不採用が決まった ${nd}社は下の欄に移動しました ↓</div>` : ""}</td>
        <td>${f?.finalized_at ? '<span class="chip done">確定 ✓</span>' : "—"}</td><td>${pl ? '<span class="chip done">完成 ✓</span>' : "—"}</td><td>${d(p.updated_at)}</td></tr>`; }).join("") || `<tr><td colspan="5" class="empty">${P.length ? "進行中の案件はありません。" : "案件はまだありません。「＋ 新規案件」から始めてください。"}</td></tr>`}
      </tbody></table></div></div>
      <div class="dec-cols">
        <div class="card dec yes"><h2>採用 <span class="muted" style="font-size:13px;font-weight:400">${decided.filter((x) => x.o.k === "yes").length}件</span></h2><p class="sub">完成処方に採用した会社、またはフィードバックで「採用」とした会社</p>${decTable("yes")}</div>
        <div class="card dec no"><h2>不採用 <span class="muted" style="font-size:13px;font-weight:400">${decided.filter((x) => x.o.k === "no").length}件</span></h2><p class="sub">フィードバックで「不採用」とした会社、または他社の処方が採用された会社</p>${decTable("no")}</div>
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
        <p class="sub">当社が代わりに登録し、ログイン情報（仮パスワード）を発行します。3つの合意書（NDA・購入宣言・処方の帰属）には、先方が最初にログインしたときに本人が同意します。</p>
        <div class="grid3">
          <div class="field"><label for="s-company_name">会社名 *</label><input id="s-company_name" required placeholder="PT ○○○ Indonesia"></div>
          <div class="field"><label for="s-full_name">担当者名 *</label><input id="s-full_name" required></div>
          <div class="field"><label for="s-email">担当者のメールアドレス *（ログインIDになります）</label><input id="s-email" type="email" required></div>
        </div>
        <div class="notice info" style="margin:0 0 12px">電話・住所・NIB・ハラール認証・取扱原料・<b>会社ロゴ（JPG）</b>の入力と<b>パスワードの変更</b>は、先方が<b>初めてログインしたときに必ず行います</b>。入力が終わるまで、先方は依頼を見られません。</div>
        <button class="btn saff" type="submit">登録してログイン情報を発行</button><div class="status" id="st-sup"></div>
        <div id="sup-result"></div></form>
      <div class="card" id="co-list"><div class="tbl-wrap"><table class="view master"><thead><tr><th>ロゴ</th><th>会社</th><th>担当者</th><th>連絡先</th><th>NIB / ハラール</th><th>主な原料</th><th>合意（NDA・購入宣言・処方帰属）</th><th>登録日</th></tr></thead><tbody>
      ${S.companies.map((c) => `<tr><td>${logoImg(c, 56)}<label class="linkbtn" style="display:block;font-size:12px;margin-top:4px;position:relative">${c.logo_path ? "ロゴを変更" : "ロゴを登録"}<input type="file" accept="image/jpeg,image/png" data-logo="${c.id}" style="position:absolute;width:1px;height:1px;opacity:0"></label>${c.logo_path ? "" : '<span class="unset" style="font-size:12px">未登録</span>'}</td><td>${FLAG_ID}<a href="#/co/${c.id}"><b>${esc(c.name)}</b></a><div class="muted" style="font-size:12px">${esc(c.address || "")}${c.website ? `<br>${esc(c.website)}` : ""}</div></td><td>${esc(c.contact_name || "")}</td>
        <td>${esc(c.contact_email || "")}<div class="muted" style="font-size:12px">${esc(c.phone || "")}${c.whatsapp ? " / WA " + esc(c.whatsapp) : ""}</div>${c.contact_email ? `<button type="button" class="linkbtn" style="font-size:12px;margin-top:4px" data-reissue="${c.id}">仮パスワードを再発行</button>` : ""}</td><td>${esc(c.nib || "—")}<div class="muted" style="font-size:12px">${esc(c.halal || "")}</div></td>
        <td style="max-width:240px">${esc(c.materials || "")}</td><td>${DOC_ORDER.map((k) => { const l = agreed(c.id, k); return `<div>${l ? `<span class="chip done">${{ nda: "NDA", purchase: "購入宣言", ip: "処方帰属" }[k]} ✓</span> <span class="muted" style="font-size:11px">${dt(l.accepted_at)}</span>` : `<span class="chip draft">${{ nda: "NDA", purchase: "購入宣言", ip: "処方帰属" }[k]} 未同意</span>`}</div>`; }).join("")}</td><td>${d(c.created_at)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">まだ登録がありません。</td></tr>`}
      </tbody></table></div></div>
      <div class="card" style="margin-top:14px"><h2>${FLAG_JP}合意文（日本語訳・確認用）</h2><p class="sub">相手は英語とインドネシア語の版に同意します。本番運用の前に、必ず弁護士の確認を受けてください。</p>
        ${terms.map((t) => `<h3>${esc(t.title_ja)}（${esc(t.version)}版）</h3><div class="brief-out ja">${esc(t.text_ja)}</div>`).join("")}</div>`;
    $("co-list").onchange = async (e) => {
      const inp = e.target.closest("[data-logo]"); if (!inp) return; const f = inp.files?.[0]; if (!f) return;
      const c = S.companies.find((x) => x.id === inp.dataset.logo);
      try { await uploadLogo(c, f); toast("完了：ロゴを登録しました", c.name); adminCompanies(); } catch (err) { toast("ロゴを登録できませんでした", err?.userMsg || String(err), "info"); }
    };
    const loginMsg = (name, email, password, reissued) => {
      const url = location.origin + location.pathname;
      return reissued
        ? `Dear ${name},\n\nArtisans Production Co., Ltd. (Japan) has issued a new temporary password for your Formula Bridge account.\nArtisans Production Co., Ltd. (Jepang) telah menerbitkan kata sandi sementara yang baru untuk akun Formula Bridge Anda.\n\nURL: ${url}\nEmail: ${email}\nTemporary password / Kata sandi sementara: ${password}\n\nPlease sign in and set your own password.\nSilakan masuk dan buat kata sandi Anda sendiri.\n\nThis information is confidential. / Informasi ini bersifat rahasia.`
        : `Dear ${name},\n\nArtisans Production Co., Ltd. (Japan) has created your account on Formula Bridge, our formula development platform.\nArtisans Production Co., Ltd. (Jepang) telah membuat akun Anda di Formula Bridge, platform pengembangan formula kami.\n\nURL: ${url}\nEmail: ${email}\nTemporary password / Kata sandi sementara: ${password}\n\n1. Sign in with the email and temporary password above.\n2. Read and accept the three agreements (NDA, Declaration of Purchase, Ownership of Adopted Formulas).\n3. Set your own password and complete your company profile (address, NIB, halal status, main raw materials and your company logo as a JPG).\n\n1. Masuk dengan email dan kata sandi sementara di atas.\n2. Baca dan setujui ketiga perjanjian (NDA, Pernyataan Pembelian, Kepemilikan Formula yang Diadopsi).\n3. Buat kata sandi baru dan lengkapi profil perusahaan (alamat, NIB, status halal, bahan baku utama, dan logo perusahaan dalam format JPG).\n\nThis information is confidential. / Informasi ini bersifat rahasia.`;
    };
    const showLogin = (msg, statusText) => {
      $("st-sup").className = "status"; $("st-sup").textContent = statusText;
      $("sup-result").innerHTML = `<div class="brief-out" style="margin-top:10px" id="sup-msg"></div><div class="row" style="margin-top:8px"><button type="button" class="btn ghost" id="copy-sup">案内文をコピー（英語・インドネシア語）</button><button type="button" class="btn ghost" id="done-sup">一覧を更新</button></div>`;
      $("sup-msg").textContent = msg;
      $("copy-sup").onclick = (ev) => copy(msg, ev.currentTarget);
      $("done-sup").onclick = () => adminCompanies();
      $("f-sup").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("co-list").onclick = (e) => {
      const b = e.target.closest("[data-reissue]"); if (!b) return;
      const c = S.companies.find((x) => x.id === b.dataset.reissue); if (!c) return;
      busy(b, $("st-sup"), "仮パスワードを発行しています…", async () => {
        await ask({ title: "仮パスワードを再発行しますか？", ok: "再発行する", body: kvHtml([["会社名", c.name], ["担当者名", c.contact_name || ""], ["ログインID", c.contact_email]])
          + '<p class="sub">いまのパスワードは使えなくなります。先方は新しい仮パスワードでログインし、自分のパスワードを設定し直します。</p>' });
        const { data, error } = await sb.functions.invoke("create-supplier", { body: { action: "reissue", email: c.contact_email } });
        let err = null; if (error) { try { err = await error.context.json(); } catch { err = { error: "network" }; } }
        if (err || !data?.ok) {
          const code = err?.error || data?.error;
          toast("仮パスワードを発行できませんでした", "登録欄の下に理由を表示しました。", "info");
          throw { userMsg: code === "not_found" ? "このメールアドレスのログインが見つかりません。上の欄から新しく登録してください。" : code === "demo" ? "デモ画面では発行できません。" : code === "network" ? "通信できませんでした。もう一度押してください。" : "発行できませんでした：" + (err?.message || code || "") };
        }
        showLogin(loginMsg(c.contact_name || "", data.email, data.password, true), "✓ 完了：新しい仮パスワードを発行しました。下の案内文を相手に送ってください（仮パスワードは今だけ表示されます）。");
        toast("完了：仮パスワードを再発行しました", `${c.name}（${data.email}）`);
      });
    };
    const SF = ["company_name", "full_name", "email"];
    $("f-sup").onsubmit = (e) => { e.preventDefault(); const stSup = $("st-sup"); busy(e.submitter || $("f-sup").querySelector("button"), stSup, "登録しています…", async () => {
      const body = Object.fromEntries(SF.map((k) => [k, $("s-" + k).value.trim()]));
      await ask({ title: "この内容で仕入先を登録しますか？", ok: "登録してログイン情報を発行", body: kvHtml([["会社名", body.company_name], ["担当者名", body.full_name], ["メールアドレス（ログインID）", body.email]])
        + '<p class="sub">メールアドレスはログインIDになり、あとから変更できません。打ち間違いがないか確認してください。</p>' });
      const { data, error } = await sb.functions.invoke("create-supplier", { body });
      let err = null; if (error) { try { err = await error.context.json(); } catch { err = { error: "network" }; } }
      if (err || !data?.ok) {
        const code = err?.error || data?.error;
        if (code === "already_registered" || code === "network") { // show the latest list, so that a company that was in fact registered can be found
          const keep = Object.fromEntries(SF.map((k) => [k, $("s-" + k).value]));
          await adminCompanies(); SF.forEach((k) => ($("s-" + k).value = keep[k]));
        }
        const target = $("st-sup");
        const m = code === "already_registered" ? "このメールアドレスは既に登録されています。下の一覧のその会社の「仮パスワードを再発行」から、新しい仮パスワードを発行できます。" : code === "is_admin_email" ? "管理者のアドレスは仕入先に使えません。"
          : code === "demo" ? "デモ画面では登録できません。" : code === "network" ? "通信できませんでした。下の一覧にこの会社が出ていれば登録は済んでいます（その場合は「仮パスワードを再発行」を押してください）。出ていなければ、接続を確認してもう一度押してください。"
          : code === "unauthorized" || code === "forbidden" ? "管理者としての確認ができませんでした。いったんログアウトし、ログインし直してから登録してください。"
          : "登録できませんでした。もう一度押してください。続く場合は、この表示を担当者に伝えてください：" + (err?.message || code || "");
        if (target !== stSup) { target.className = "status err"; target.textContent = m; throw CANCELLED; } // page was redrawn
        throw { userMsg: m };
      }
      const msg = loginMsg(body.full_name, data.email, data.password);
      showLogin(msg, (data.repaired ? "✓ 完了：途中で止まっていた登録を修復し、新しい仮パスワードを発行しました。" : "✓ 完了：登録しました。") + "下のログイン情報を相手に送ってください（仮パスワードは今だけ表示されます）。");
      SF.forEach((k) => ($("s-" + k).value = "")); // prevents registering the same company twice by mistake
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
        <div class="field"><label for="s-from">送信元（例：処方ブリッジ &lt;noreply@自社ドメイン&gt;）</label><input id="s-from" value="${esc(conf.from_email || "")}" placeholder="未設定の場合はテスト用の送信元を使います"></div>
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
        return `<tr><td><b>${L[k]}</b></td><td>${!x.key ? `<span class="chip draft">鍵が未登録</span> <span class="muted">Secrets に <code>${K[k]}</code> を登録してください</span>` : x.ok ? `<span class="chip done">接続OK ✓</span> <span class="muted">${esc(x.model)}</span>` : `<span class="chip" style="border-color:var(--warn);color:var(--warn)">鍵はあるが接続できない</span> <span class="muted">${esc({ no_credit: "利用残高（クレジット）不足 — Billing で入金・支払い設定が必要", rate_limited: "混雑・利用上限（少し待って再確認）", not_configured: "鍵が正しくない（入れ直してください）", bad_request: "設定エラー" }[x.error] || x.error || "")}　${esc(x.message || "")}</span>`}</td></tr>`; }).join("")}</table>`;
    });
    $("mail-test").onclick = (e) => busy(e.currentTarget, $("st-set"), "テストメールを送っています…", async () => {
      const { data, error } = await sb.functions.invoke("notify", { body: { event: "test" } });
      if (error) throw { userMsg: "送信できませんでした（通信エラー）。" };
      $("st-set").className = data?.sent ? "status" : "status err";
      $("st-set").textContent = data?.sent ? `✓ 送信しました：${data.to.join(", ")} の受信箱を確認してください。`
        : data?.reason === "not_configured" ? "メールサーバーがまだ設定されていません（指示書の手順2を確認してください）。"
        : data?.reason === "no_dev_email" ? "開発専用メールアドレスを入れて保存してから押してください。"
        : "送信に失敗しました：" + (data?.detail || "") ;
      if (data?.reason !== "demo") { const h = location.hash; setTimeout(() => { if (location.hash === h) adminSettings(); }, 4000); }
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
      <div class="card"><div class="head"><h2>${FLAG_JP}依頼書</h2><div class="seg"><button type="button" data-b="en" aria-pressed="true">English</button><button type="button" data-b="id" aria-pressed="false">Bahasa Indonesia</button><button type="button" data-b="ja" aria-pressed="false">日本語（確認用）</button></div></div>
        <div class="brief-out" id="brief"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="go-brief">依頼書を作成（英語・インドネシア語）</button><button class="btn ghost" id="copy-brief">コピー</button></div><div class="status" id="st-brief"></div></div>
      <div class="card"><h2>${FLAG_JP}依頼先を選んで送る</h2><p class="sub">選んだ会社の登録メールアドレスに、入力用リンクが自動で送られます。</p>
        <div class="pick co-tiles" id="pick">${S.companies.map((c) => { const a = P.as.find((x) => x.company_id === c.id); return `<label class="co-pick"><input type="checkbox" value="${c.id}"><span class="co-tick" aria-hidden="true">${a && a.status !== "draft" ? "依頼済み（選ぶと再送）" : "選択"}</span>${coCard(c, a)}</label>`; }).join("") || '<div class="muted">登録企業がありません。「登録企業」の画面から仕入先を登録してください。</div>'}</div>
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
- 最後に「開発後に提出してほしいもの」として次を列挙: 製品の特徴、処方（% w/w・INCI名・インドネシア語の原料名〔Nama bahan〕）、主要原料の特徴とメーカーデータ・グラフ、規格書・SDS・COA、営業資料、第三者機関の試験データ。提出物は英語で記入すること（ただしインドネシア語の原料名〔Nama bahan〕はインドネシア語のまま）。
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
        ${list.map((c) => { const was = P.as.find((a) => a.company_id === c.id && a.status !== "draft"); return `<div class="co-card-wrap">${was ? '<div class="status err" style="margin:0 0 4px">この会社には依頼済みです。依頼内容を最新にして、もう一度メールを送ります。</div>' : ""}${coCard(c)}</div>`; }).join("")}
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
      { const h = location.hash; setTimeout(() => { if (location.hash === h) adminProject(p.id, "req"); }, 1500); }
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
          <div class="card"><h2>${FLAG_ID}A. Product overview</h2><p class="sub">仕入先が入力した内容（仕入先の画面と同じ配置・閲覧のみ）</p>
            <div class="targets"><div><span>${FLAG_JP}目標原料費（1個あたり）</span><b>${esc(rq.costRaw || "—")}</b></div><div><span>${FLAG_JP}目標完成品コスト（1個あたり）</span><b>${esc(rq.costFin || "—")}</b></div><div><span>${FLAG_JP}予定小売価格（税込）</span><b>${esc(rq.price || "—")}</b></div></div>
            <div class="grid2 mirror">${PRODUCT_FIELDS.map(([k, l]) => { const wide = ["concept", "features", "claims", "stability", "process"].includes(k), v = sp.product[k];
              return `<div class="field ${wide ? "span2" : ""}"><label>${esc(l)}${k === "name" ? " *" : ""}</label><div class="ro-box ${wide ? "tall" : ""} ${v ? "" : "empty"}">${v ? esc(v) : "未入力 / not filled in"}</div></div>`; }).join("")}</div></div>
          <div class="card"><div class="head"><h2>${FLAG_ID}B. Base formula</h2>${(() => { const nx = sp.formula.some((r) => (r.trade || r.idName || r.inci) && !r.ja); return `<div class="to-ja-wrap">${nx ? '<span class="next-tag">未変換の原料があります</span>' : ""}<button class="btn ${nx ? "next" : "ghost"}" id="to-ja">日本語表示名称に変換</button></div>`; })()}</div><p class="sub" style="margin:0 0 8px">配合量の単位：<b>${sp.formulaUnit && sp.formulaUnit !== "%" ? esc(sp.formulaUnit) + " per batch（%は自動計算）" : "% w/w（合計100%）"}</b></p><div class="tbl-wrap"><table class="edit mirror" id="t-f"></table></div>
            <div class="row" style="margin-top:8px"><span class="spacer"></span><span class="muted" style="font-size:12.5px">処方表を保存：</span><button type="button" class="btn ghost" id="a-xlsx">Excel</button><button type="button" class="btn ghost" id="a-pdf">PDF</button></div><div class="status" id="st-toja"></div></div>
          <div class="card"><h2>${FLAG_ID}C. Raw material highlights</h2><p class="sub">主要原料の特徴とメーカーのデータ</p><div class="tbl-wrap"><table class="edit mirror" id="t-m"></table></div></div>
          <div class="card"><h2>${FLAG_ID}D. Third-party test data</h2><p class="sub">第三者機関による試験</p><div class="tbl-wrap"><table class="edit mirror" id="t-t"></table></div></div>
          <div class="card"><h2>${FLAG_ID}E. Attachments</h2><div class="files">${sp.files.map((f, i) => `<div class="file"><span class="cat">${esc(f.cat)}</span><div><button class="linkbtn" data-open="${i}">${esc(f.name)}</button>${f.desc ? `<div class="d">${esc(f.desc)}</div>` : ""}</div><span></span></div>`).join("") || '<div class="hint">なし</div>'}</div></div>
          <div class="card" style="${cur.shipped_at ? "border-color:var(--ok)" : ""}"><h2>${FLAG_ID}F. サンプル発送</h2>
            ${cur.shipped_at ? `<dl class="kv"><dt>発送完了の連絡</dt><dd>${dt(cur.shipped_at)}</dd><dt>運送会社</dt><dd>${esc(cur.shipment?.carrier || "—")}</dd><dt>追跡番号</dt><dd><b class="mono">${esc(cur.shipment?.tracking || "—")}</b> <button class="btn ghost" id="copy-trk">コピー</button></dd><dt>発送日</dt><dd>${esc(cur.shipment?.date || "—")}</dd><dt>数量</dt><dd>${esc(cur.shipment?.qty || "—")}</dd><dt>備考</dt><dd>${esc(cur.shipment?.note || "—")}</dd></dl>` : '<p class="muted">まだ発送の連絡はありません。</p>'}</div>
        </div>
        <div class="card" style="margin-top:14px;${cur.feedback_at ? "border-color:var(--ok)" : cur.status === "submitted" || cur.shipped_at ? "border-color:var(--warn)" : ""}">
          <h2>${FLAG_JP}当社からのフィードバック（必須）</h2>
          ${cur.feedback_at ? `<p class="sub">送信済み：${dt(cur.feedback_at)}　判定：<b>${esc(cur.feedback?.decision || "")}</b></p><div class="brief-out ja">${esc(cur.feedback?.ja || "")}</div><p class="sub" style="margin-top:10px">追加のフィードバックを送る場合は、下で書き直して再送できます。</p>` : '<p class="sub">サンプルと提出内容を確認したら、必ずフィードバックを送ってください。日本語で書けば、英語とインドネシア語に訳して相手にメールします。</p>'}
          <div class="field"><label for="fb-dec">判定</label><select id="fb-dec">${FB_DECISIONS.map(([ja]) => `<option ${cur.feedback?.decision === ja ? "selected" : ""}>${ja}</option>`).join("")}</select></div>
          <div class="field"><label for="fb-ja">コメント（日本語）</label><textarea id="fb-ja" style="min-height:120px" placeholder="例：使用感はベンチマークに近いが、べたつきが残る。増粘剤を見直して再試作をお願いしたい。">${esc(cur.feedback_at ? "" : cur.feedback?.ja || "")}</textarea></div>
          <button class="btn big" id="fb-send">翻訳して確認する（送る前に確認できます）</button><div class="status" id="st-fb"></div></div>`;
      pv.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { cur = sent.find((a) => a.id === b.dataset.a); draw(); }));
      pv.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openFile(sp.files[+b.dataset.open].path)));
      if ($("copy-trk")) $("copy-trk").onclick = (e) => copy(cur.shipment?.tracking || "", e.currentTarget);
      $("fb-send").onclick = (e) => busy(e.currentTarget, $("st-fb"), "翻訳して送っています…", async () => {
        const ja = $("fb-ja").value.trim(), dec = FB_DECISIONS.find(([x]) => x === $("fb-dec").value);
        if (!ja) throw { userMsg: "コメントを入力してください。" };
        $("st-fb").textContent = "翻訳しています…（送る前に確認画面が出ます）";
        const r = await ai(`次は日本の化粧品メーカー（株式会社Artisans Production）から、インドネシアの原料メーカーの開発担当者へのサンプル評価フィードバックです。丁寧で具体的なビジネス文として、英語(en)とインドネシア語(id)に正確に翻訳してください。意味を足さず、数値・成分名はそのまま残すこと。
${GLOSSARY}
JSONのみで返答: {"en": string, "id": string}

判定: ${dec[0]} / ${dec[1]}
コメント:
${ja}`, { effort: "low" });
        if (!r.en) throw { userMsg: "翻訳に失敗しました。もう一度押してください。" };
        await ask({ title: `${coName(cur.company_id)} にフィードバックを送りますか？`, ok: "この内容で送る", tone: "saff",
          body: `<p class="sub">相手には英語とインドネシア語で届きます。訳文を確認してください。</p>${kvHtml([["判定", `${dec[0]}（${dec[1]}）`]])}
            <h3>日本語（原文）</h3><div class="brief-out ja">${esc(ja)}</div><h3>English</h3><div class="brief-out">${esc(r.en)}</div><h3>Bahasa Indonesia</h3><div class="brief-out">${esc(r.id || "")}</div>` });
        const feedback = { decision: dec[0], decision_en: dec[1], decision_id: dec[2] || "", ja, en: String(r.en), id: String(r.id || ""), history: [...(cur.feedback?.history || []), ...(cur.feedback?.ja ? [{ at: cur.feedback_at, decision: cur.feedback.decision, ja: cur.feedback.ja }] : [])] };
        const { data: up, error } = await sb.from("assignments").update({ feedback, feedback_at: new Date().toISOString() }).eq("id", cur.id).select("*").single();
        if (error) throw error;
        Object.assign(cur, up);
        const { data: n } = await sb.functions.invoke("notify", { body: { event: "feedback", assignment_id: cur.id } });
        draw(); $("st-fb").textContent = "✓ 完了：フィードバックを送りました" + (n?.sent ? "（メール送信済み）" : "（メール未設定のため画面のみ）");
        toast("完了：フィードバックを送りました", `${coName(cur.company_id)} に英語・インドネシア語で届きます。`);
      });
      const fcols = sp.formulaUnit && sp.formulaUnit !== "%" ? COLS.formula.flatMap((c) => c.k === "pct" ? [{ k: "amt", l: `Amount (${sp.formulaUnit}) per batch / Jumlah (${sp.formulaUnit}) per batch`, w: 110, num: true, total: true }, { k: "pct", l: "% w/w (auto) / % b/b (otomatis)", w: 90, num: true }] : [c]) : COLS.formula;
      editTable($("t-f"), fcols, sp.formula, () => {}, { totalCheck: true, readOnly: true });
      const co = S.companies.find((c) => c.id === cur.company_id), am = () => ({ project: P.p.name, company: co?.name, logo: logoUrls[co?.logo_path], unit: sp.formulaUnit || "%", rows: sp.formula, requester: cur.request_snapshot?.request?.requester });
      $("a-xlsx").onclick = async () => download(fileBase(P.p.name, "formula_" + (co?.name || "")) + ".xlsx", await formulaXlsx(am()));
      $("a-pdf").onclick = (e) => busy(e.currentTarget, $("st-toja"), "PDFを作成しています…", async () => { if (!sp.formula.length) throw { userMsg: "処方がまだありません。" }; download(fileBase(P.p.name, "formula_" + (co?.name || "")) + ".pdf", await formulaPdf(am())); $("st-toja").textContent = "✓ PDFを保存しました"; });
      editTable($("t-m"), COLS.materials, sp.materials, () => {}, { readOnly: true });
      editTable($("t-t"), COLS.tests, sp.tests, () => {}, { readOnly: true });
      $("to-ja").onclick = (e) => busy(e.currentTarget, $("st-toja"), "変換しています…", async () => {
        // Convert on the latest data and write back only the Japanese-name fields, so the supplier's newer edits survive.
        const { data: fresh, error: e1 } = await sb.from("assignments").select("supplier").eq("id", cur.id).maybeSingle(); if (e1) throw e1;
        const latest = Object.assign({ product: {}, formula: [], materials: [], tests: [], files: [] }, fresh?.supplier || {});
        const n = await convertToJapanese(latest.formula);
        const { data: again } = await sb.from("assignments").select("supplier").eq("id", cur.id).maybeSingle();
        const merged = Object.assign({}, again?.supplier || latest);
        merged.formula = (merged.formula || []).map((r, i) => { const c = latest.formula[i]; return c && (c.trade || "") === (r.trade || "") && (c.idName || "") === (r.idName || "") ? { ...r, ja: c.ja, jaNote: c.jaNote, mix: c.mix, inci: r.inci || c.inci } : r; });
        const { error } = await sb.from("assignments").update({ supplier: merged }).eq("id", cur.id); if (error) throw error;
        cur.supplier = merged;
        draw(); $("st-toja").textContent = `${n}行を変換しました。`;
      });
    };
    draw();
  }

  const FB_DECISIONS = [["採用候補", "Candidate for adoption", "Kandidat untuk diadopsi"], ["再試作を依頼", "Please revise and send a new sample", "Mohon lakukan revisi dan kirimkan sampel baru"], ["不採用", "Not adopted this time", "Tidak diadopsi kali ini"],
    ["採用（本処方は当社に帰属）", "Adopted — under the Ownership of Adopted Formulas agreement, this formula now belongs to Artisans Production Co., Ltd.", "Diadopsi — sesuai perjanjian Kepemilikan Formula yang Diadopsi, formula ini kini menjadi milik Artisans Production Co., Ltd."]];
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
        <div class="pick">${subm.map((a) => `<label><input type="radio" name="adopt" value="${a.id}" ${a.id === fin.adopted_assignment ? "checked" : ""}> ${FLAG_ID}${esc(coName(a.company_id))}<span class="muted" style="font-size:12px;margin-left:8px">${esc(a.supplier?.product?.name || "")}　原料見積：${esc(a.supplier?.product?.cost || "—")}</span></label>`).join("") || '<div class="muted">まだ提出がありません。</div>'}</div></div>
      <div class="card"><div class="head"><h2>${FLAG_ID}採用した会社の提出内容（日本語訳）</h2><button class="btn ghost" id="tr-sup" ${adopted ? "" : "disabled"}>日本語に翻訳</button></div><div class="brief-out ja" id="sup-ja">${esc(fin.sup_ja || (adopted ? "「日本語に翻訳」を押すと表示します。" : "ベース処方を選んでください。"))}</div><div class="status" id="st-tr"></div></div>
      <div class="card"><h2>${FLAG_JP}当社で追記する原料</h2><div class="tbl-wrap"><table class="edit" id="t-add"></table></div>
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="add-row">＋ 原料を追加</button><button class="btn ghost" id="qs">水で100%に調整</button></div><div class="status" id="st-qs"></div></div>
      <div class="card"><div class="head"><h2>${FLAG_JP}完成処方</h2><span id="tot"></span></div><div class="tbl-wrap"><table class="view" id="t-final"></table></div>
        <h3>全成分表示（自動作成・配合量の多い順）</h3><div class="fulllist" id="full"></div><div class="row" style="margin-top:8px"><button class="btn ghost" id="copy-full">全成分をコピー</button></div>
        <p class="sub" style="margin-top:8px">1%以下の成分は順不同で表示できます。複数成分を含む原料（※）は並び順を要確認。</p></div>
      <div class="card"><h2>${FLAG_JP}商品計画</h2>
        <div class="targets"><div><span>希望原料費</span><b>${esc(P.p.request?.costRaw || "—")}</b></div><div><span>希望完成品コスト</span><b>${esc(P.p.request?.costFin || "—")}</b></div><div><span>${FLAG_ID}原料見積（採用社）</span><b>${esc(adopted?.supplier?.product?.cost || "—")}</b></div></div>
        <div class="grid2">${[["productName", "商品名"], ["brand", "ブランド名"], ["target", "ターゲット顧客"], ["price", "販売価格（税込）"], ["cost", "完成品コスト（1本・確定値）"], ["channel", "販売チャネル"], ["launch", "発売時期"], ["goal", "初年度の販売目標"]].map(([k, l]) => `<div class="field"><label for="pl-${k}">${l}</label><input id="pl-${k}" value="${esc(fin.plan[k] || "")}"></div>`).join("")}</div>
        <div class="field"><label for="pl-usp">当社としての強み・差別化ポイント</label><textarea id="pl-usp">${esc(fin.plan.usp || "")}</textarea></div></div>
      <div class="card"><h2>${FLAG_JP}完成処方を確定する</h2><p class="sub">合計100%・全原料の日本語表示名称・商品名がそろうと確定できます。</p><button class="btn big" id="fix">完成処方を確定</button><div class="status" id="st-fix"></div></div>
    </div>`;
    const save = saver(async () => { const { error } = await sb.from("finals").upsert(fin); if (error) throw error; }, $("saved"));
    const render = () => {
      const rows = finalRows(fin), tot = rows.reduce((a, r) => a + r.pct, 0);
      $("tot").innerHTML = rows.length ? `<span class="${Math.abs(tot - 100) <= 0.01 ? "total-ok" : "total-bad"}">合計 ${fmt(tot)}%</span>` : "";
      $("t-final").innerHTML = `<thead><tr><th>No.</th><th>区分</th><th class="ja-col">日本語表示名称</th><th>確認事項（AI）</th><th>INCI</th><th>配合量 %</th><th>配合目的</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="no">${i + 1}</td><td><span class="badge ${r.src}">${r.src === "base" ? "ベース" : "当社追加"}</span></td><td>${esc(r.ja) || `<span class="hint">（未変換：${esc(r.label)}）</span>`}</td><td class="jnote">${esc(r.jaNote)}</td><td class="inci">${esc(r.inci)}</td><td class="num">${fmt(r.pct)}</td><td>${esc(r.fn)}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">ベース処方を選んでください。</td></tr>'}</tbody>`;
      const list = fullList(rows); $("full").textContent = list.length ? list.map((x) => x.n + (x.mix ? "※" : "")).join("、") : "—";
    };
    // Any change to the formula after it was finalized takes the "finalized" mark away (it must be confirmed again).
    const unfix = () => { if (fin.finalized_at) { fin.finalized_at = null; toast("完成処方の確定を解除しました", "処方を変更したため、もう一度「完成処方を確定」を押してください。", "info"); } };
    const tA = editTable($("t-add"), COLS.additions, fin.additions, () => { unfix(); save.soon(); render(); });
    $("add-row").onclick = tA.add;
    pv.querySelectorAll('input[name="adopt"]').forEach((r) => (r.onchange = () => {
      const a = P.as.find((x) => x.id === r.value); fin.adopted_assignment = a.id; fin.base_formula = JSON.parse(JSON.stringify(a.supplier?.formula || [])); fin.sup_ja = ""; unfix();
      save.soon(); save.now().then(() => adminProject(P.p.id, "fin"), (err) => toast("保存できませんでした", err?.userMsg || "", "info"));
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
      w.pct = String(nw); unfix(); save.soon(); render(); st.className = "status"; st.textContent = `水を ${fmt(nw)}% に調整しました（合計100%）。`;
    };
    $("copy-full").onclick = (e) => copy(fullList(finalRows(fin)).map((x) => x.n).join("、"), e.currentTarget);
    ["productName", "brand", "target", "price", "cost", "channel", "launch", "goal", "usp"].forEach((k) => ($("pl-" + k).oninput = (e) => { fin.plan[k] = e.target.value; save.soon(); }));
    $("fix").onclick = (e) => busy(e.currentTarget, $("st-fix"), "確定しています…", async () => {
      const rows = finalRows(fin), tot = rows.reduce((a, r) => a + r.pct, 0), miss = [];
      if (!rows.length) miss.push("完成処方がありません");
      else if (Math.abs(tot - 100) > 0.01) miss.push(`合計が ${fmt(tot)}% です（100%にしてください）`);
      if (rows.some((r) => !r.ja)) miss.push("日本語表示名称が未変換の原料があります（STEP 2 の変換ボタン）");
      if (!fin.plan.productName) miss.push("商品名が未入力です");
      if (miss.length) throw { userMsg: "確定できません：" + miss.join("／") };
      await ask({ title: "完成処方を確定しますか？", ok: "確定する", body: kvHtml([["採用するベース", coName(P.as.find((a) => a.id === fin.adopted_assignment)?.company_id)], ["原料数", `${rows.length}件`], ["合計", `${fmt(tot)}%`], ["商品名", fin.plan.productName]])
        + '<p class="sub">確定すると、採用したメーカーは提出内容を変更できなくなります（採用処方の証拠として固定されます）。あとで処方を変えた場合は、確定が自動で外れます。</p>' });
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
    const checks = [[P.as.some((a) => a.status !== "draft"), "依頼を送った"], [!!adopted, "採用するベース処方を選んだ"], [rows.length > 0 && Math.abs(tot - 100) <= 0.01, `完成処方の合計が100%（現在 ${fmt(tot)}%）`],
      [!!fin.finalized_at, "完成処方を確定した"], [(sp.tests || []).length > 0, "第三者試験データがある"], [!!fin.plan?.price, "販売価格を記入した"], [!!S.market, "市場データが登録されている"]];
    pv.innerHTML = `<div class="who jp ${done.plan ? "is-done" : ""}">${FLAG_JP}日本側が操作する画面<span class="state">${done.plan ? "完了 ✓" : "未作成"}</span></div>
    <div class="stack"><div class="cols">
      <div class="card"><h2>${FLAG_JP}作成前のチェック</h2><p class="sub">不足があっても作れますが、その部分は【要確認】と表示されます。</p>
        <ul class="checklist">${checks.map(([ok, t]) => `<li><span class="mk ${ok ? "ok" : "ng"}">${ok ? "OK" : "未完了"}</span><span>${esc(t)}</span></li>`).join("")}</ul></div>
      <div class="card"><h2>${FLAG_JP}企画書を作る</h2><p class="sub">3社のAIで作成します：①Gemini が Google 検索で最新の市場を調査 → ②Claude がメーカー提出資料（添付PDF・画像を含む）から下書き → ③GPT が取締役目線で査読 → ④Claude が指摘を反映して仕上げ。数字は作らず、出典のないものは【要確認】と表示します。配合%は社外秘として載せません。</p>
        <button class="btn big" id="go-plan">企画書を作成</button><div class="status" id="st-plan"></div>
        <h3>ダウンロード（10ページ）</h3><div class="row"><button class="btn saff" id="dl-pptx" ${P.plan ? "" : "disabled"}>PowerPoint</button><button class="btn saff" id="dl-docx" ${P.plan ? "" : "disabled"}>Word</button></div><div class="status" id="st-dl"></div>
        <h3>市場データ</h3><div class="src">${S.market ? `調査時点：${esc(S.market.asOf || "—")}<br><span style="color:var(--warn)">${esc(S.market.verification || "")}</span>` : "未登録"}</div></div></div>
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
      $("slides").innerHTML = pl ? pl.slides.map((s, i) => `<div class="slide ${s.key === "cover" ? "cover" : ""}"><span class="sn">${String(i + 1).padStart(2, "0")}</span><h4>${esc(s.key === "cover" ? pl.title : s.title)}</h4><p>${esc(s.key === "cover" ? pl.subtitle : s.lead)}</p><ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="att">${[s.chart ? "グラフ：" + esc(s.chart.title) : "", s.table ? `表 ${s.table.rows.length}行` : "", s.imagePath ? "画像" : "", (s.sources || []).length ? `出典 ${s.sources.length}件` : ""].filter(Boolean).join("　")}</div></div>`).join("") : '<div class="hint">「企画書を作成」を押すと、ここに10ページの構成が表示されます。</div>';
    };
    renderSlides();
    // Plan builder (4 steps): Gemini researches the market with Google Search → Claude drafts from the supplier's data and
    // attachments → GPT reviews the draft like a board member → Claude revises. If a key is missing, that step is skipped.
    $("go-plan").onclick = (e) => busy(e.currentTarget, $("st-plan"), "企画書を作成しています…", async () => {
      await ask({ title: "企画書を作成しますか？", ok: "作成する", body: `<p>市場調査 → 下書き → 査読 → 仕上げ の4工程で作成します。<b>3〜6分ほど</b>かかり、各社のAI利用料がかかります。</p>${P.plan ? '<p class="sub">作成済みの企画書は新しい内容に置き換わります。</p>' : ""}<p class="sub">作成中はこの画面を閉じないでください。</p>` });
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
      toast("完了：企画書ができました", (log.length ? "一部の工程を省略しました。詳細は画面の「AIの分担と経過」をご覧ください。" : "Gemini・Claude・GPT の3社のAIで作成しました。") + "PowerPoint・Word ボタンから保存できます。"); adminProject(p.id, "plan");
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
      <div class="panes"><div class="pane id"><div class="pane-head"><span class="lang">${FLAG_ID}Bahasa Indonesia</span><span class="role" id="role-id">Hasil terjemahan / 翻訳結果</span></div><textarea id="t-id" readonly></textarea>
        <div class="back" id="back-wrap"><b>逆翻訳（意味の確認用） / Terjemahan balik (untuk memeriksa makna)</b><span id="back"></span></div><div class="pane-foot"><span></span><button class="btn ghost" id="c-id">コピー / Salin</button></div></div>
      <div class="pane ja"><div class="pane-head"><span class="lang">${FLAG_JP}日本語</span><span class="role" id="role-ja">ここに入力 / Tulis di sini</span></div><textarea id="t-ja"></textarea>
        <div class="pane-foot"><span class="hint">Ctrl / ⌘ + Enter</span><button class="btn" id="go">翻訳する / Terjemahkan</button></div></div></div><div class="status" id="st-t"></div>`;
    let dir = "ja2id";
    const setDir = (x) => { dir = x; $("d-ja").setAttribute("aria-pressed", String(x === "ja2id")); $("d-id").setAttribute("aria-pressed", String(x === "id2ja")); $("t-ja").readOnly = x !== "ja2id"; $("t-id").readOnly = x === "ja2id"; $("role-ja").textContent = x === "ja2id" ? "ここに入力 / Tulis di sini" : "翻訳結果 / Hasil terjemahan"; $("role-id").textContent = x === "ja2id" ? "Hasil terjemahan / 翻訳結果" : "Tulis di sini / ここに入力"; $("back-wrap").hidden = x !== "ja2id"; };
    $("d-ja").onclick = () => setDir("ja2id"); $("d-id").onclick = () => setDir("id2ja");
    $("c-id").onclick = (e) => copy($("t-id").value, e.currentTarget);
    const go = () => busy($("go"), $("st-t"), "翻訳しています… / Menerjemahkan…", async () => {
      const src = (dir === "ja2id" ? $("t-ja") : $("t-id")).value.trim(); if (!src) throw { userMsg: "文章を入力してください。 / Silakan masukkan teks." };
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
    const [{ data: logs, error }, terms] = await Promise.all([sb.from("agreement_log").select("doc, version").eq("user_id", S.user.id), loadTerms()]);
    if (error || !terms.length) return false; // could not check: never skip the agreements
    return terms.every((t) => (logs || []).some((l) => l.doc === t.doc && l.version === t.version));
  }
  async function viewAgreementGate() {
    $("nav").innerHTML = "";
    const terms = await loadTerms();
    if (!terms.length) {
      app.innerHTML = `<div class="auth card en"><h1>${FLAG_ID}Agreements / Perjanjian</h1><p class="status err">The agreements could not be loaded. Please check your connection and try again. / Perjanjian tidak dapat dimuat. Periksa koneksi Anda dan coba lagi.</p><button class="btn" type="button" id="gate-retry">Try again / Coba lagi</button></div>`;
      $("gate-retry").onclick = () => route(); return;
    }
    app.innerHTML = `<div class="auth card en" style="max-width:760px"><h1>${FLAG_ID}Agreements / Perjanjian</h1>
      <p class="lang-note">Please read and agree to continue. / Harap baca dan setujui untuk melanjutkan.</p>
      <form id="f-gate"><div id="gate-terms">${termsBlock(terms)}</div><button class="btn saff" type="submit">Agree and continue / Setuju dan lanjutkan</button><div class="status" id="st-gate"></div></form></div>`;
    wireTerms($("gate-terms"));
    $("f-gate").onsubmit = async (e) => {
      e.preventDefault();
      const ag = agreedFrom($("gate-terms"));
      if (terms.some((t) => ag[t.doc] !== t.version)) { $("st-gate").className = "status err"; $("st-gate").textContent = "Please tick all boxes. / Harap centang semua kotak."; return; }
      const rows = terms.map((t) => ({ user_id: S.user.id, company_id: S.profile.company_id, doc: t.doc, version: t.version, user_agent: navigator.userAgent.slice(0, 300) }));
      const { error } = await sb.from("agreement_log").insert(rows);
      if (error) { $("st-gate").className = "status err"; $("st-gate").textContent = "Could not save / Gagal menyimpan: " + error.message; return; }
      if (ag.nda && S.company && !S.company.nda_agreed_at) await sb.from("companies").update({ nda_agreed_at: new Date().toISOString() }).eq("id", S.company.id);
      toast("Thank you ✓ / Terima kasih ✓", "Agreements recorded. / Persetujuan telah dicatat."); route();
    };
  }

  /* First sign-in of a supplier: own password + company profile (with logo) before anything else. */
  const mustChangePassword = () => !!S.user?.user_metadata?.must_change_password;
  const needsOnboarding = () => !S.isAdmin && (mustChangePassword() || (S.company && !S.company.profile_completed_at));
  const ONB = [["phone", "Phone / Telepon", true], ["whatsapp", "WhatsApp", false], ["address", "Company address / Alamat perusahaan", true], ["website", "Website / Situs web", false],
    ["nib", "Business ID (NIB) / Nomor Induk Berusaha (NIB)", true], ["halal", "Halal certification (write \"None\" if none) / Sertifikasi halal (tulis \"Tidak ada\" jika tidak ada)", true], ["materials", "Main raw materials you supply / Bahan baku utama yang Anda pasok", true]];
  async function viewOnboarding() {
    $("nav").innerHTML = "";
    const c = S.company; if (c) await loadLogos([c]);
    const pwBlock = () => `<div id="o-pw"><h2 style="font-size:16px;margin:14px 0 6px">1. Your new password / Kata sandi baru Anda</h2>
        <div class="grid2"><div class="field"><label for="o-p1">New password (min. 8 characters) / Kata sandi baru (min. 8 karakter) *</label><input id="o-p1" type="password" minlength="8" required autocomplete="new-password"></div>
          <div class="field"><label for="o-p2">New password again / Ulangi kata sandi baru *</label><input id="o-p2" type="password" minlength="8" required autocomplete="new-password"></div></div></div>`;
    app.innerHTML = `<div class="auth card en" style="max-width:760px"><h1>${FLAG_ID}Welcome — first-time setup / Selamat datang — pengaturan awal</h1>
      <p class="lang-note">Please complete these steps once. You can see requests from Japan after this. / Harap lengkapi langkah berikut satu kali sebelum melihat permintaan dari Jepang.</p>
      <form id="f-onb" autocomplete="off">
        ${mustChangePassword() ? pwBlock() : ""}
        ${c ? `<h2 style="font-size:16px;margin:14px 0 6px">${mustChangePassword() ? "2" : "1"}. Company profile / Profil perusahaan</h2>
        <div class="field"><label>Company name / Nama perusahaan</label><div class="ro-box" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--ground)">${esc(c.name || "")}</div></div>
        <p class="req-note">* Required / Wajib diisi</p>
        <div class="grid2">${ONB.map(([k, l, req]) => `<div class="field ${k === "materials" || k === "address" ? "span2" : ""}"><label for="o-${k}">${l}${req ? " *" : ""}</label><input id="o-${k}" value="${esc(c[k] || "")}" ${req ? "required" : ""}></div>`).join("")}</div>
        <div class="field"><label for="o-logo">Company logo (JPG) / Logo perusahaan (JPG) *</label><div class="logo-in">${logoImg(c, 72)}<input id="o-logo" type="file" accept="image/jpeg,image/png" ${c.logo_path ? "" : "required"}><span id="o-logo-prev"></span></div>
          <p class="sub" style="margin:4px 0 0">Japan uses your logo to tell suppliers apart. / Jepang menggunakan logo Anda untuk membedakan pemasok.</p></div>` : `<p class="status err">Your account is not linked to a company yet. Please contact Artisans Production. / Akun Anda belum terhubung dengan perusahaan. Silakan hubungi Artisans Production.</p>`}
        <button class="btn saff big" type="submit">Save and continue / Simpan dan lanjutkan</button><div class="status" id="st-onb"></div></form></div>`;
    if (c) logoPreview($("o-logo"), $("o-logo-prev"));
    $("f-onb").onsubmit = (e) => { e.preventDefault(); busy(e.submitter || $("f-onb").querySelector("button"), $("st-onb"), "Saving… / Menyimpan…", async () => {
      const needPw = mustChangePassword() && $("o-p1");
      if (needPw) {
        if ($("o-p1").value.length < 8) throw { userMsg: "Use at least 8 characters. / Gunakan minimal 8 karakter." };
        if ($("o-p1").value !== $("o-p2").value) throw { userMsg: "The two passwords do not match. / Kedua kata sandi tidak cocok." };
      }
      const patch = {};
      if (c) {
        for (const [k, l, req] of ONB) { patch[k] = $("o-" + k).value.trim(); if (req && !patch[k]) throw { userMsg: "Please fill in / Harap isi: " + l }; }
        if (!$("o-logo").files?.[0] && !c.logo_path) throw { userMsg: "Please choose your company logo (JPG). / Pilih logo perusahaan (JPG)." };
      }
      if (needPw) {
        const { data, error } = await sb.auth.updateUser({ password: $("o-p1").value, data: { must_change_password: false } });
        if (error) throw { userMsg: "Could not change the password / Gagal mengganti kata sandi: " + error.message };
        if (data?.user) S.user = data.user;
        $("o-pw").remove(); // done: a retry only saves the company profile
      }
      if (!c) { route(); return; }
      const f = $("o-logo").files?.[0];
      if (f) { await uploadLogo(c, f); $("o-logo").value = ""; $("o-logo").required = false; }
      patch.profile_completed_at = new Date().toISOString();
      const { error } = await sb.from("companies").update(patch).eq("id", c.id);
      if (error) throw { userMsg: "Could not save / Gagal menyimpan: " + error.message };
      Object.assign(c, patch); S.company = c;
      toast("Setup complete ✓ / Pengaturan selesai ✓", "Thank you. You can now see requests from Japan. / Terima kasih. Sekarang Anda dapat melihat permintaan dari Jepang.");
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
      if (h.startsWith("#/reset")) return viewReset();
      if (/^#\/(a|p)\//.test(h)) pendingHash = h;
      return viewLogin();
    }
    if (FROM_INVITE && S.user && !sessionStorage.getItem("fb-invite-done")) { try { sessionStorage.setItem("fb-invite-done", "1"); } catch {} return viewUpdatePassword(); }
    if (fromLogin && pendingHash) { const x = pendingHash; pendingHash = null; if (location.hash !== x) { location.hash = x; return; } }
    if (!S.profile) { app.innerHTML = `<div class="card">Your account is being set up. Please reload in a moment. / Akun Anda sedang disiapkan. Muat ulang sebentar lagi. / アカウントを準備中です。しばらくしてから再読み込みしてください。</div>`; return; }
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
    nav([["#/", "Requests / Permintaan"], ["#/company", "Company / Perusahaan"], ["#/translate", "Translate / Terjemahkan"], ["#/password", "Password / Kata sandi"]]);
    if (parts[0] === "password") return viewUpdatePassword(true);
    if (parts[0] === "a" && parts[1]) return supplierAssignment(parts[1]);
    if (parts[0] === "company") return supplierCompany();
    if (parts[0] === "translate") return viewTranslate();
    return supplierHome();
  }
  window.addEventListener("hashchange", () => route());

  /* Live notifications while the page is open */
  // Realtime sends only the primary key in "old" under RLS, so compare with what this browser last saw.
  const seen = {};
  let liveCh = null;
  function stopLive() { if (liveCh) { sb.removeChannel?.(liveCh); liveCh = null; } }
  function live() {
    if (liveCh) return;
    sb.from("assignments").select("id, status, shipped_at, feedback_at").then(({ data }) => (data || []).forEach((a) => (seen[a.id] = a)));
    liveCh = sb.channel("assignments").on("postgres_changes", { event: "UPDATE", schema: "public", table: "assignments" }, (m) => {
      const n = m.new, o = seen[n.id] || {}; seen[n.id] = { id: n.id, status: n.status, shipped_at: n.shipped_at, feedback_at: n.feedback_at };
      if (S.isAdmin && n.status === "submitted" && o.status !== "submitted") toast(`${coName(n.company_id)} から提出がありました`, "マスター画面・STEP 2 で確認できます。", "info");
      if (!S.isAdmin && n.status === "requested" && o.status !== "requested") toast("New request from Japan / Permintaan baru dari Jepang", "Please open it from Requests. / Silakan buka dari menu Requests / Permintaan.", "info");
      if (S.isAdmin && n.shipped_at && !o.shipped_at) toast(`${coName(n.company_id)} がサンプルを発送しました`, `追跡番号：${n.shipment?.tracking || ""}`, "info");
      if (!S.isAdmin && n.feedback_at && n.feedback_at !== o.feedback_at) toast("Feedback from Japan / Umpan balik dari Jepang", "Feedback has been received. / Umpan balik telah diterima.", "info");
    }).subscribe();
  }

  (async () => {
    await afterSignIn();
  })();
})();
