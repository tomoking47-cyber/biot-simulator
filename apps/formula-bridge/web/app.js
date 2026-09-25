/* 処方ブリッジ Formula Bridge — hosted app (Supabase).
 * Roles: admin (Japan) sees everything; supplier (Indonesian company) sees only its own assignments.
 * Access is enforced by row level security; this file only decides what to show.
 */
(() => {
  "use strict";
  const sb = supabase.createClient(FB_CONFIG.supabaseUrl, FB_CONFIG.supabaseKey);
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : 0; };
  const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
  const today = () => new Date().toISOString().slice(0, 10);
  const dt = (s) => (s ? new Date(s).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const d = (s) => (s ? new Date(s).toLocaleDateString("ja-JP") : "—");
  const one = (x) => (Array.isArray(x) ? x[0] : x) || null;
  const FLAG_JP = '<i class="flag jp" role="img" aria-label="日本"></i>';
  const FLAG_ID = '<i class="flag id" role="img" aria-label="Indonesia"></i>';

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
  const libs = { XLSX: "vendor/xlsx.full.min.js", PptxGenJS: "vendor/pptxgen.bundle.js", docx: "vendor/docx.iife.js" };
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
  const AI_ERR = { not_configured: "AIの設定（APIキー）がまだです。設定手順をご確認ください。", rate_limited: "混み合っています。1分ほど待ってからもう一度押してください。", refused: "この内容は処理できませんでした。表現を変えてお試しください。", unauthorized: "ログインし直してください。" };
  function parseJSON(text) {
    const t = String(text).trim();
    try { return JSON.parse(t); } catch {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
    const a = Math.min(...["{", "["].map((c) => (t.indexOf(c) + 1 || Infinity) - 1)), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (isFinite(a) && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    throw { userMsg: "結果の形式が崩れました。もう一度押してください。" };
  }
  async function ai(prompt, { effort = "medium", image } = {}) {
    const { data, error } = await sb.functions.invoke("ai", { body: { prompt, effort, image } });
    if (error) {
      let code = ""; try { code = (await error.context.json()).error; } catch {}
      throw { userMsg: AI_ERR[code] || "通信が途切れました。もう一度押してください。" };
    }
    return parseJSON(data.text);
  }
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
      <h1>処方ブリッジ Formula Bridge</h1>
      <p class="lang-note">${FLAG_JP}${FLAG_ID} Sign in / Masuk / ログイン</p>
      <form id="f-login">
        <div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="l-pass">Password</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
        <div class="row"><button class="btn" type="submit">Sign in / ログイン</button><span class="spacer"></span><button class="linkbtn" type="button" id="to-reset">Forgot password?</button></div>
        <div class="status" id="st-login" role="status" aria-live="polite"></div>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <p class="sub" style="margin:0 0 8px">${FLAG_ID} New supplier? Register your company here. / Perusahaan baru? Daftar di sini.</p>
      <a class="btn saff" href="#/register" style="text-decoration:none;display:inline-block">Register company / Daftar perusahaan</a>
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
      <p class="lang-note">Pendaftaran pemasok · 仕入先の企業登録. After registering, requests from Japan will appear on your page and be emailed to you.</p>
      <form id="f-reg">
        ${REG_FIELDS.map(([k, l, req, type]) => `<div class="field"><label for="g-${k}">${esc(l)}${req ? " *" : ""}</label>${k === "company.materials" || k === "company.address"
          ? `<textarea id="g-${k}"></textarea>` : `<input id="g-${k}" type="${type || "text"}" ${req ? "required" : ""} ${type === "password" ? 'minlength="8" autocomplete="new-password"' : ""}>`}</div>`).join("")}
        <label class="check" style="margin:6px 0 12px"><input type="checkbox" id="g-nda" required> I agree to keep all information received through Formula Bridge confidential and to use it only for development with the Japanese company. / Saya setuju menjaga kerahasiaan informasi. *</label>
        <div class="row"><button class="btn saff" type="submit">Register / Daftar</button><a href="#/login" class="linkbtn">Back to sign in</a></div>
        <div class="status" id="st-reg" role="status" aria-live="polite"></div>
      </form></div>`;
    $("f-reg").onsubmit = async (e) => {
      e.preventDefault();
      const v = (k) => $("g-" + k).value.trim(), st = $("st-reg");
      st.className = "status"; st.textContent = "Registering…";
      const company = {}; REG_FIELDS.filter(([k]) => k.startsWith("company.")).forEach(([k]) => (company[k.slice(8)] = v(k)));
      const { data, error } = await sb.auth.signUp({
        email: v("email"), password: $("g-password").value,
        options: { emailRedirectTo: location.origin + location.pathname, data: { full_name: v("full_name"), title: v("title"), phone: v("phone"), whatsapp: v("whatsapp"), nda: $("g-nda").checked, company } },
      });
      if (error) { st.className = "status err"; st.textContent = /registered/i.test(error.message) ? "This email is already registered. Please sign in." : "Could not register: " + error.message; return; }
      if (!data.session) { st.className = "status"; st.innerHTML = "✓ Registered. We sent a confirmation email — please open the link in it, then sign in.<br>✓ Terdaftar. Silakan buka tautan di email konfirmasi, lalu masuk."; return; }
      toast("Registered ✓", "Welcome to Formula Bridge."); await loadMe(); route(true);
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
  function viewUpdatePassword() {
    $("topbar").hidden = true;
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
      { k: "phase", l: "Phase", w: 60 }, { k: "trade", l: "Trade name", w: 150 }, { k: "idName", l: "Nama bahan (Indonesian label name)", w: 190 },
      { k: "inci", l: "INCI name", w: 190 }, { k: "maker", l: "Supplier / maker", w: 130 }, { k: "pct", l: "% w/w", w: 80, num: true },
      { k: "fn", l: "Function", w: 120 }, { k: "ja", l: "日本語表示名称", ja: true, w: 170 } ],
    materials: [{ k: "material", l: "Raw material", w: 180 }, { k: "feature", l: "Key feature", w: 280 }, { k: "data", l: "Supporting data (supplier / literature)", w: 360 }],
    tests: [{ k: "lab", l: "Laboratory", w: 160 }, { k: "item", l: "Test item", w: 170 }, { k: "method", l: "Method / n", w: 170 }, { k: "result", l: "Result", w: 260 }, { k: "date", l: "Date", w: 100 }],
    additions: [{ k: "ja", l: "日本語表示名称", w: 200 }, { k: "inci", l: "INCI", w: 200 }, { k: "pct", l: "配合量 %", w: 90, num: true }, { k: "purpose", l: "配合目的", w: 160 }, { k: "note", l: "備考（仕入先など）", w: 200 }],
  };
  /* An editable table bound to an array; onChange is called after every edit. */
  function editTable(el, cols, rows, onChange, { totalCheck = false, readOnly = false } = {}) {
    const render = () => {
      if (el.contains(document.activeElement)) return;
      const tot = rows.reduce((a, r) => a + num(r.pct), 0), pi = cols.findIndex((c) => c.k === "pct");
      el.innerHTML = `<thead><tr><th>No.</th>${cols.map((c) => `<th class="${c.ja ? "ja-col" : ""}" style="min-width:${c.w}px">${esc(c.l)}</th>`).join("")}${readOnly ? "" : "<th></th>"}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td class="no">${i + 1}</td>${cols.map((c) => c.ja || readOnly
          ? `<td class="${c.ja ? "ja" : c.num ? "num" : ""}" style="padding:8px">${esc(r[c.k] ?? "")}${c.ja && r.jaNote ? `<span class="nt">${esc(r.jaNote)}</span>` : ""}</td>`
          : `<td class="${c.num ? "num" : ""}"><input data-i="${i}" data-k="${c.k}" value="${esc(r[c.k] ?? "")}" aria-label="${esc(c.l)} ${i + 1}" ${c.num ? 'inputmode="decimal"' : ""}></td>`).join("")}
          ${readOnly ? "" : `<td><button class="x" data-del="${i}" aria-label="Delete row">×</button></td>`}</tr>`).join("") || `<tr><td colspan="${cols.length + 2}" class="hint" style="padding:12px">No rows yet / まだ行がありません</td></tr>`}</tbody>
        ${pi >= 0 ? `<tfoot><tr><td colspan="${pi + 1}" style="text-align:right">Total</td><td class="num ${totalCheck ? (Math.abs(tot - 100) < 0.001 ? "total-ok" : "total-bad") : ""}">${fmt(tot)}</td><td colspan="${cols.length - pi + (readOnly ? -1 : 0)}"></td></tr></tfoot>` : ""}`;
    };
    el.oninput = (e) => {
      const t = e.target; if (!t.dataset.k) return; const r = rows[+t.dataset.i]; if (!r) return;
      r[t.dataset.k] = t.value;
      if (["idName", "inci", "trade"].includes(t.dataset.k) && "ja" in r && cols.some((c) => c.ja)) { r.ja = ""; r.jaNote = ""; }
      if (t.dataset.k === "pct") { const c = el.querySelector("tfoot td.num"); if (c) { const tot = rows.reduce((a, x) => a + num(x.pct), 0); c.textContent = fmt(tot); if (totalCheck) c.className = "num " + (Math.abs(tot - 100) < 0.001 ? "total-ok" : "total-bad"); } }
      onChange();
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
    const { data: rows, error } = await sb.from("assignments").select("id, status, request_snapshot, requested_at, submitted_at, updated_at").order("requested_at", { ascending: false });
    app.innerHTML = `<div class="who id">${FLAG_ID}${esc(S.company?.name || "")} — requests from Japan<small>Permintaan dari Jepang · Only your company can see these.</small></div>
      <div class="card en"><h2>Requests / Permintaan</h2>
      ${error ? `<p class="status err">${esc(error.message)}</p>` : (rows || []).length ? `<div class="tbl-wrap"><table class="view master"><thead><tr><th>Project</th><th>Received</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td>${esc(a.request_snapshot?.name || "(project)")}</td><td>${d(a.requested_at)}</td><td>${chip(a.status, true)}</td><td>${d(a.submitted_at)}</td><td><a href="#/a/${a.id}">Open / Buka →</a></td></tr>`).join("")}
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
    app.innerHTML = `<div class="who id ${a.status === "submitted" ? "is-done" : ""}">${FLAG_ID}Your company fills in this page · Diisi oleh tim Indonesia<small>Please write in English</small><span class="state">${a.status === "submitted" ? "Done ✓" : "In progress"}</span></div>
    <div class="stack en">
      <div class="card"><div class="head"><h2>${FLAG_JP}Request from Japan: ${esc(snap.name || "")}</h2>
        <div class="seg"><button type="button" data-rq="en" aria-pressed="true">English</button><button type="button" data-rq="id" aria-pressed="false">Bahasa Indonesia</button></div></div>
        <div class="brief-out" id="dev-brief"></div></div>
      <div class="card"><h2>${FLAG_ID}A. Product overview</h2><p class="sub">Changes are saved automatically. <span class="saved" id="saved"></span></p>
        <div class="targets"><div><span>${FLAG_JP}TARGET RAW MATERIAL COST / UNIT</span><b>${esc(rq.costRaw || "—")}</b></div><div><span>${FLAG_JP}TARGET FINISHED PRODUCT COST / UNIT</span><b>${esc(rq.costFin || "—")}</b></div><div><span>${FLAG_JP}PLANNED RETAIL PRICE</span><b>${esc(rq.price || "—")}</b></div></div>
        <div id="prod-fields"></div></div>
      <div class="card"><div class="head"><div><h2>${FLAG_ID}B. Base formula (% w/w)</h2><p class="sub" style="margin:0">Enter the Indonesian label name (Nama bahan) and %. The Japanese name is filled in by the button.</p></div>
        <button class="btn ghost" id="to-ja">Convert to Japanese names / 日本語表示名称に変換</button></div>
        <div class="tbl-wrap"><table class="edit" id="t-formula"></table></div>
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="add-formula">＋ Add row</button></div><div class="status" id="st-toja"></div></div>
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
          <button class="btn ghost" id="xl-out">Excel template</button><label class="btn ghost" style="position:relative">Import from Excel<input type="file" id="xl-in" accept=".xlsx,.xls" style="position:absolute;width:1px;height:1px;opacity:0"></label></div>
        <div class="status" id="st-submit"></div></div>
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

    $("prod-fields").innerHTML = PRODUCT_FIELDS.map(([k, l]) => `<div class="field"><label for="p-${k}">${esc(l)}</label>${["concept", "features", "claims", "stability", "process"].includes(k) ? `<textarea id="p-${k}"></textarea>` : `<input id="p-${k}">`}</div>`).join("");
    PRODUCT_FIELDS.forEach(([k]) => { const el = $("p-" + k); el.value = sp.product[k] || ""; el.oninput = () => { sp.product[k] = el.value; save.soon(); }; });
    const tF = editTable($("t-formula"), COLS.formula, sp.formula, save.soon, { totalCheck: true });
    const tM = editTable($("t-materials"), COLS.materials, sp.materials, save.soon);
    const tT = editTable($("t-tests"), COLS.tests, sp.tests, save.soon);
    $("add-formula").onclick = tF.add; $("add-materials").onclick = tM.add; $("add-tests").onclick = tT.add;
    $("to-ja").onclick = (e) => busy(e.currentTarget, $("st-toja"), "Converting… / 変換しています…", async () => {
      const n = await convertToJapanese(sp.formula); tF.render(); save.soon(); await save.now();
      $("st-toja").textContent = `${n} rows converted.`;
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

    $("submit").onclick = (e) => busy(e.currentTarget, $("st-submit"), "Submitting…", async () => {
      const miss = [], tot = sp.formula.reduce((x, r) => x + num(r.pct), 0);
      if (!sp.product.name) miss.push("Product name");
      if (!sp.formula.length) miss.push("Formula");
      else if (Math.abs(tot - 100) > 0.001) miss.push(`Formula total is ${fmt(tot)}% (must be 100%)`);
      if (miss.length) throw { userMsg: "Please check: " + miss.join(", ") };
      await save.now();
      const { error } = await sb.from("assignments").update({ supplier: sp, status: "submitted" }).eq("id", aid);
      if (error) throw { userMsg: "Could not submit: " + error.message };
      status = "submitted";
      const { data: r } = await sb.functions.invoke("notify", { body: { event: "submit", assignment_id: aid } });
      $("st-submit").className = "status"; $("st-submit").textContent = "✓ Done: submitted to Japan." + (r?.sent ? " Japan has been emailed." : "");
      toast("Done: submitted to Japan ✓", r?.sent ? "Japan's development team has been notified by email." : "Japan will see it on the master screen. Terima kasih!");
      document.querySelector(".who").classList.add("is-done"); document.querySelector(".who .state").textContent = "Done ✓";
    });

    // Excel round-trip
    const SHEETS = { Formula: "formula", Materials: "materials", ThirdParty: "tests" };
    $("xl-out").onclick = async () => {
      const XLSX = await lib("XLSX"), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Formula Bridge — Development sheet"], ["Fill in every sheet in English. Formula total must be 100%."], [], ["Request from Japan:"], ...String(snap.brief?.en || "").split("\n").map((l) => [l])]), "Guide");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Field", "Value"], ...PRODUCT_FIELDS.map(([k, l]) => [l, sp.product[k] || ""])]), "Product");
      Object.entries(SHEETS).forEach(([sheet, key]) => { const cols = COLS[key].filter((c) => !c.ja); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols.map((c) => c.l), ...sp[key].map((r) => cols.map((c) => r[c.k] ?? ""))]), sheet); });
      download("FormulaBridge_" + (snap.name || "request").replace(/[^\w\-]+/g, "_") + ".xlsx", new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })]));
    };
    $("xl-in").onchange = async (e) => {
      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
      try {
        const XLSX = await lib("XLSX"), wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        if (wb.Sheets.Product) XLSX.utils.sheet_to_json(wb.Sheets.Product, { header: 1 }).slice(1).forEach(([l, v]) => { const hit = PRODUCT_FIELDS.find(([, x]) => x === String(l || "").trim()); if (hit && v != null) sp.product[hit[0]] = String(v); });
        Object.entries(SHEETS).forEach(([sheet, key]) => {
          const ws = wb.Sheets[sheet]; if (!ws) return; const cols = COLS[key].filter((c) => !c.ja);
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }), head = (rows[0] || []).map((h) => String(h || "").trim());
          const out = rows.slice(1).filter((r) => r.some((c) => String(c ?? "").trim())).map((r) => { const o = {}; cols.forEach((c) => { const j = head.indexOf(c.l); if (j >= 0 && r[j] != null) o[c.k] = String(r[j]); }); return o; });
          if (out.length) sp[key].splice(0, sp[key].length, ...out);
        });
        save.soon(); await save.now(); supplierAssignment(aid); toast("Imported ✓", f.name);
      } catch { $("st-submit").className = "status err"; $("st-submit").textContent = "This file could not be read. Please use the template."; }
    };
  }

  async function supplierCompany() {
    const c = S.company || {};
    const F = [["name", "Company name"], ["contact_name", "Contact person"], ["contact_email", "Contact email"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["address", "Address"], ["website", "Website"], ["nib", "Business ID (NIB)"], ["halal", "Halal certification"], ["materials", "Main raw materials"]];
    app.innerHTML = `<div class="who id">${FLAG_ID}Company profile / Profil perusahaan</div><form class="card en" id="f-co">
      ${F.map(([k, l]) => `<div class="field"><label for="c-${k}">${l}</label><input id="c-${k}" value="${esc(c[k] || "")}"></div>`).join("")}
      <p class="sub">NDA agreed: ${dt(c.nda_agreed_at)}</p><button class="btn" type="submit">Save</button><div class="status" id="st-co"></div></form>`;
    $("f-co").onsubmit = async (e) => {
      e.preventDefault(); const patch = {}; F.forEach(([k]) => (patch[k] = $("c-" + k).value.trim()));
      const { error } = await sb.from("companies").update(patch).eq("id", c.id);
      $("st-co").textContent = error ? "Could not save: " + error.message : "Saved ✓"; if (!error) Object.assign(S.company, patch);
    };
  }

  /* ================= ADMIN (Japan) ================= */
  async function loadCompanies() { const { data } = await sb.from("companies").select("*").order("created_at"); S.companies = data || []; return S.companies; }
  const coName = (id) => S.companies.find((c) => c.id === id)?.name || "(company)";

  async function adminHome() {
    await loadCompanies();
    const { data: projects } = await sb.from("projects").select("id, name, request, created_at, updated_at, assignments(id, company_id, status, requested_at, submitted_at, updated_at), finals(finalized_at), plans(created_at)").order("updated_at", { ascending: false });
    const P = projects || [];
    const stats = S.companies.map((c) => {
      const as = P.flatMap((p) => p.assignments || []).filter((a) => a.company_id === c.id);
      return { c, req: as.filter((a) => a.status !== "draft").length, dev: as.filter((a) => a.status === "requested" || a.status === "developing").length, sub: as.filter((a) => a.status === "submitted").length };
    });
    app.innerHTML = `<div class="who jp">${FLAG_JP}マスター画面<small>依頼している全社の状況・依頼内容・進捗</small></div>
      <div class="head"><h2 style="margin:0">登録企業 ${S.companies.length}社</h2><button class="btn" id="new-proj">＋ 新規案件</button></div>
      <div class="kpis">${stats.map(({ c, req, dev, sub }) => `<div class="kpi"><div class="co">${FLAG_ID}${esc(c.name)}</div>
        <div class="nums"><div><b>${req}</b>依頼</div><div><b>${dev}</b>開発中</div><div><b>${sub}</b>提出済み</div></div>
        <div class="muted" style="font-size:12px">${esc(c.contact_name || "")}　${esc(c.contact_email || "")}</div></div>`).join("") || `<div class="kpi"><div class="muted">まだ登録企業がありません。インドネシア各社にこのページのURLを送り、「Register company」から登録してもらってください。</div></div>`}</div>
      <div class="card"><h2>${FLAG_JP}案件一覧</h2><div class="tbl-wrap" style="margin-top:10px"><table class="view master"><thead><tr><th>案件</th><th>依頼先と進捗</th><th>完成処方</th><th>企画書</th><th>更新</th></tr></thead><tbody>
      ${P.map((p) => { const as = (p.assignments || []).filter((a) => a.status !== "draft"), f = one(p.finals), pl = one(p.plans);
        return `<tr><td><a href="#/p/${p.id}">${esc(p.name)}</a><div class="muted" style="font-size:12px">${esc(p.request?.cat || "")}</div></td>
        <td>${as.length ? as.map((a) => `<div style="display:flex;gap:6px;align-items:center;margin:2px 0">${FLAG_ID}<span>${esc(coName(a.company_id))}</span>${chip(a.status)}<span class="muted" style="font-size:11px">${a.submitted_at ? "提出 " + d(a.submitted_at) : "依頼 " + d(a.requested_at)}</span></div>`).join("") : '<span class="chip draft">未依頼</span>'}</td>
        <td>${f?.finalized_at ? '<span class="chip done">確定 ✓</span>' : "—"}</td><td>${pl ? '<span class="chip done">完成 ✓</span>' : "—"}</td><td>${d(p.updated_at)}</td></tr>`; }).join("") || `<tr><td colspan="5" class="empty">案件はまだありません。「＋ 新規案件」から始めてください。</td></tr>`}
      </tbody></table></div></div>`;
    $("new-proj").onclick = async () => {
      const { data, error } = await sb.from("projects").insert({ name: "新規案件", created_by: S.user.id, request: { markets: ["jp"] } }).select("id").single();
      if (error) { toast("案件を作れませんでした", error.message, "info"); return; }
      location.hash = "#/p/" + data.id;
    };
  }

  async function adminCompanies() {
    await loadCompanies();
    app.innerHTML = `<div class="who jp">${FLAG_JP}登録企業</div><div class="card"><div class="tbl-wrap"><table class="view master"><thead><tr><th>会社</th><th>担当者</th><th>連絡先</th><th>NIB / ハラール</th><th>主な原料</th><th>秘密保持同意</th><th>登録日</th></tr></thead><tbody>
      ${S.companies.map((c) => `<tr><td>${FLAG_ID}<b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.address || "")}${c.website ? `<br>${esc(c.website)}` : ""}</div></td><td>${esc(c.contact_name || "")}</td>
        <td>${esc(c.contact_email || "")}<div class="muted" style="font-size:12px">${esc(c.phone || "")}${c.whatsapp ? " / WA " + esc(c.whatsapp) : ""}</div></td><td>${esc(c.nib || "—")}<div class="muted" style="font-size:12px">${esc(c.halal || "")}</div></td>
        <td style="max-width:240px">${esc(c.materials || "")}</td><td>${c.nda_agreed_at ? '<span class="chip done">同意済み</span>' : '<span class="chip draft">未同意</span>'}</td><td>${d(c.created_at)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">まだ登録がありません。</td></tr>`}
      </tbody></table></div></div>`;
  }

  async function adminSettings() {
    const { data: rows } = await sb.from("settings").select("*");
    const conf = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    const { data: logs } = await sb.from("mail_log").select("*").order("created_at", { ascending: false }).limit(20);
    const { data: admins } = await sb.from("admin_emails").select("email");
    app.innerHTML = `<div class="who jp">${FLAG_JP}設定</div><div class="stack">
      <form class="card" id="f-set"><h2>メールの設定</h2><p class="sub">インドネシア側からの提出は「開発専用メールアドレス」に自動で届きます。</p>
        <div class="field"><label for="s-dev">開発専用メールアドレス（複数はカンマ区切り）</label><input id="s-dev" type="text" value="${esc(conf.dev_email || "")}" placeholder="dev@example.co.jp"></div>
        <div class="field"><label for="s-from">送信元（例: 処方ブリッジ &lt;noreply@御社ドメイン&gt;）</label><input id="s-from" value="${esc(conf.from_email || "")}" placeholder="未設定の場合はテスト用の送信元を使います"></div>
        <div class="field"><label for="s-url">このサイトのURL（メール内のリンク先）</label><input id="s-url" value="${esc(conf.app_url || location.origin + location.pathname.replace(/index\.html$/, ""))}"></div>
        <button class="btn" type="submit">保存</button><div class="status" id="st-set"></div></form>
      <div class="card"><h2>管理者（日本側）のメールアドレス</h2><p class="sub">ここにあるアドレスで新規登録した人は、日本側の管理者になります。</p>
        <ul>${(admins || []).map((a) => `<li class="mono">${esc(a.email)}</li>`).join("")}</ul>
        <div class="row"><input id="adm-new" type="email" placeholder="staff@example.co.jp" style="font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--ground);color:var(--ink)"><button class="btn ghost" id="adm-add">追加</button></div></div>
      <div class="card"><h2>メール送信の記録（最新20件）</h2><div class="tbl-wrap"><table class="view"><thead><tr><th>日時</th><th>種類</th><th>宛先</th><th>件名</th><th>結果</th></tr></thead><tbody>
        ${(logs || []).map((l) => `<tr><td>${dt(l.created_at)}</td><td>${l.kind === "request" ? "依頼" : "提出"}</td><td>${esc(l.to_email)}</td><td>${esc(l.subject)}</td><td>${l.ok ? '<span class="chip done">送信済み</span>' : `<span class="chip draft" title="${esc(l.detail)}">未送信</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">まだありません</td></tr>`}
      </tbody></table></div></div></div>`;
    $("f-set").onsubmit = async (e) => {
      e.preventDefault();
      const up = [["dev_email", $("s-dev").value.trim()], ["from_email", $("s-from").value.trim()], ["app_url", $("s-url").value.trim()]].map(([key, value]) => ({ key, value }));
      const { error } = await sb.from("settings").upsert(up);
      $("st-set").textContent = error ? "保存できませんでした: " + error.message : "保存しました ✓";
    };
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
    const done = { req: sent.length > 0, dev: subm.length > 0 && subm.length === sent.length, fin: !!P.fin.finalized_at, plan: !!P.plan };
    step = step || "req";
    const stepBtn = (k, n, t, w, flag) => `<a role="tab" href="#/p/${pid}/${k}" aria-selected="${step === k}" class="${done[k] ? "done" : ""} ${k === "dev" ? "id-side" : ""}" style="text-decoration:none"><span class="n">${flag}${n}</span><span class="t">${t}</span><span class="w">${w}</span></a>`;
    app.innerHTML = `<div class="row" style="margin-bottom:10px"><a href="#/" class="linkbtn">← マスター画面</a><span class="spacer"></span><b>${esc(p.name)}</b></div>
      <nav class="steps" role="tablist" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${stepBtn("req", "STEP 1", "依頼", "当社が記入", FLAG_JP)}${stepBtn("dev", "STEP 2", "各社の開発", `提出 ${subm.length} / ${sent.length}社`, FLAG_ID)}
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
      ${REQ_LABELS.map(([k, l]) => `<div class="field"><label for="r-${k}">${l}</label>${["feel", "claim", "avoid", "note"].includes(k) ? `<textarea id="r-${k}">${esc(r[k] || "")}</textarea>` : `<input id="r-${k}" value="${esc(r[k] || "")}">`}</div>`).join("")}
      <div class="field"><label>販売予定の市場</label><div class="checks" id="r-markets">${Object.entries(MK).map(([k, l]) => `<label><input type="checkbox" value="${k}" ${(r.markets || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
    </form>
    <div class="stack">
      <div class="card"><div class="head"><h2>${FLAG_JP}依頼書</h2><div class="seg"><button type="button" data-b="en" aria-pressed="true">English</button><button type="button" data-b="id" aria-pressed="false">Indonesia</button><button type="button" data-b="ja" aria-pressed="false">日本語（確認用）</button></div></div>
        <div class="brief-out" id="brief"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="go-brief">依頼書を作成（英語・インドネシア語）</button><button class="btn ghost" id="copy-brief">コピー</button></div><div class="status" id="st-brief"></div></div>
      <div class="card"><h2>${FLAG_JP}依頼先を選んで送る</h2><p class="sub">選んだ会社の登録メールアドレスに、入力用リンクが自動で送られます。</p>
        <div class="pick" id="pick">${S.companies.map((c) => { const a = P.as.find((x) => x.company_id === c.id); return `<label><input type="checkbox" value="${c.id}" ${a && a.status !== "draft" ? "checked" : ""}> ${FLAG_ID}<span>${esc(c.name)}<br><span class="muted" style="font-size:12px">${esc(c.contact_email || "")}</span></span>${a ? chip(a.status) : ""}</label>`; }).join("") || '<div class="muted">登録企業がありません。インドネシア各社に登録してもらってください。</div>'}</div>
        <div class="row" style="margin-top:10px"><button class="btn saff big" id="send">依頼を送る</button></div><div class="status" id="st-send"></div></div>
    </div></div>`;
    const save = saver(async () => { const { error } = await sb.from("projects").update({ name: p.name, request: r, brief }).eq("id", p.id); if (error) throw error; }, $("saved"));
    $("r-name").oninput = (e) => { p.name = e.target.value; save.soon(); };
    REQ_LABELS.forEach(([k]) => ($("r-" + k).oninput = (e) => { r[k] = e.target.value; save.soon(); }));
    $("r-markets").onchange = () => { r.markets = [...$("r-markets").querySelectorAll("input:checked")].map((i) => i.value); save.soon(); };
    let bl = "en";
    const renderBrief = () => { $("brief").textContent = brief[bl] || "まだ作成していません。左を記入して「依頼書を作成」を押してください。"; $("brief").classList.toggle("ja", bl === "ja" || !brief[bl]); document.querySelectorAll("[data-b]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.b === bl))); };
    document.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => { bl = b.dataset.b; renderBrief(); }));
    renderBrief();
    $("copy-brief").onclick = (e) => copy(brief[bl] || "", e.currentTarget);
    $("go-brief").onclick = (e) => busy(e.currentTarget, $("st-brief"), "依頼書を作成しています…（20〜60秒）", async () => {
      const body = REQ_LABELS.filter(([k]) => r[k]).map(([k, l]) => `${l}: ${r[k]}`).concat((r.markets || []).length ? ["販売予定の市場: " + r.markets.map((m) => MK[m]).join("、")] : []).join("\n");
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
    $("send").onclick = (e) => busy(e.currentTarget, $("st-send"), "送信しています…", async () => {
      const ids = [...$("pick").querySelectorAll("input:checked")].map((i) => i.value);
      if (!brief.en) throw { userMsg: "先に「依頼書を作成」を押してください。" };
      if (!ids.length) throw { userMsg: "依頼先を1社以上選んでください。" };
      await save.now();
      const snapshot = { name: p.name, brief: { en: brief.en, id: brief.id }, request: { costRaw: r.costRaw || "", costFin: r.costFin || "", price: r.price || "", vol: r.vol || "", date: r.date || "" } };
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
      pv.innerHTML = `<div class="who id ${cur.status === "submitted" ? "is-done" : ""}">${FLAG_ID}インドネシア側が入力する内容（閲覧のみ）<small>各社は自社の依頼だけを見られます</small><span class="state">${cur.status === "submitted" ? "提出済み ✓" : "未提出"}</span></div>
        <div class="cotabs">${sent.map((a) => `<button type="button" data-a="${a.id}" aria-pressed="${a.id === cur.id}">${FLAG_ID}${esc(coName(a.company_id))} ${chip(a.status)}</button>`).join("")}</div>
        <div class="stack en">
          <div class="card"><h2>${FLAG_ID}A. Product overview</h2><dl class="kv">${PRODUCT_FIELDS.map(([k, l]) => `<dt>${esc(l)}</dt><dd>${esc(sp.product[k] || "—")}</dd>`).join("")}</dl></div>
          <div class="card"><div class="head"><h2>${FLAG_ID}B. Base formula</h2><button class="btn ghost" id="to-ja">日本語表示名称に変換</button></div><div class="tbl-wrap"><table class="view" id="t-f"></table></div><div class="status" id="st-toja"></div></div>
          <div class="card"><h2>${FLAG_ID}C. Raw material highlights</h2><div class="tbl-wrap"><table class="view" id="t-m"></table></div></div>
          <div class="card"><h2>${FLAG_ID}D. Third-party tests</h2><div class="tbl-wrap"><table class="view" id="t-t"></table></div></div>
          <div class="card"><h2>${FLAG_ID}E. Attachments</h2><div class="files">${sp.files.map((f, i) => `<div class="file"><span class="cat">${esc(f.cat)}</span><div><button class="linkbtn" data-open="${i}">${esc(f.name)}</button>${f.desc ? `<div class="d">${esc(f.desc)}</div>` : ""}</div><span></span></div>`).join("") || '<div class="hint">なし</div>'}</div></div>
        </div>`;
      pv.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { cur = sent.find((a) => a.id === b.dataset.a); draw(); }));
      pv.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openFile(sp.files[+b.dataset.open].path)));
      editTable($("t-f"), COLS.formula, sp.formula, () => {}, { totalCheck: true, readOnly: true });
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
      $("t-final").innerHTML = `<thead><tr><th>No.</th><th>区分</th><th class="ja-col">日本語表示名称</th><th>INCI</th><th>配合量 %</th><th>配合目的</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="no">${i + 1}</td><td><span class="badge ${r.src}">${r.src === "base" ? "ベース" : "当社追加"}</span></td><td>${esc(r.ja) || `<span class="hint">（未変換: ${esc(r.label)}）</span>`}${r.jaNote ? `<div class="hint" style="color:var(--warn)">${esc(r.jaNote)}</div>` : ""}</td><td class="inci">${esc(r.inci)}</td><td class="num">${fmt(r.pct)}</td><td>${esc(r.fn)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">ベース処方を選んでください。</td></tr>'}</tbody>`;
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
      <div class="card"><h2>${FLAG_JP}企画書を作る</h2><p class="sub">市場・競合は出典つきの調査データだけを使い、数字は作りません。配合%は社外秘として載せません。</p>
        <button class="btn big" id="go-plan">出来上がり（企画書を作成）</button><div class="status" id="st-plan"></div>
        <h3>ダウンロード（10ページ）</h3><div class="row"><button class="btn saff" id="dl-pptx" ${P.plan ? "" : "disabled"}>PowerPoint</button><button class="btn saff" id="dl-docx" ${P.plan ? "" : "disabled"}>Word</button></div><div class="status" id="st-dl"></div>
        <h3>市場データ</h3><div class="src">${S.market ? `調査時点: ${esc(S.market.asOf || "—")}<br><span style="color:var(--warn)">${esc(S.market.verification || "")}</span>` : "未登録"}</div></div></div>
      <div class="card"><div class="head"><h2>${esc(P.plan?.title || "企画書プレビュー")}</h2><span class="saved">${P.plan ? "作成日 " + esc(P.plan.date) : ""}</span></div><div class="slides" id="slides"></div></div></div>`;
    const renderSlides = () => {
      const pl = P.plan;
      $("slides").innerHTML = pl ? pl.slides.map((s, i) => `<div class="slide ${s.key === "cover" ? "cover" : ""}"><span class="sn">${String(i + 1).padStart(2, "0")}</span><h4>${esc(s.key === "cover" ? pl.title : s.title)}</h4><p>${esc(s.key === "cover" ? pl.subtitle : s.lead)}</p><ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="att">${[s.chart ? "グラフ: " + esc(s.chart.title) : "", s.table ? `表 ${s.table.rows.length}行` : "", s.imagePath ? "画像" : "", (s.sources || []).length ? `出典 ${s.sources.length}件` : ""].filter(Boolean).join("　")}</div></div>`).join("") : '<div class="hint">「出来上がり」を押すと、ここに10ページの構成が表示されます。</div>';
    };
    renderSlides();
    $("go-plan").onclick = (e) => busy(e.currentTarget, $("st-plan"), "企画書を作成しています…（1〜3分お待ちください）", async () => {
      const mkSel = p.request?.markets || ["jp"];
      const pick = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => mkSel.includes(k)));
      const market = S.market ? { asOf: S.market.asOf, markets: pick(S.market.markets), competitors: pick(S.market.competitors), regulatory: S.market.regulatory || [] } : null;
      const input = { project: p.name, request: p.request, supplier_en: supplierEnglish(sp).slice(0, 12000), supplier_ja: (fin.sup_ja || "").slice(0, 8000), final_formula_names: rows.map((r) => ({ name: r.ja || r.label, inci: r.inci, purpose: r.fn, origin: r.src === "base" ? "インドネシア側ベース" : "当社追記" })), product_plan: fin.plan || {}, market };
      const plan = await ai(`あなたは上場化粧品メーカーの経営企画室長です。取締役会に出す新商品の企画書（10ページ）を日本語で作ります。
次のJSONデータだけを根拠に書くこと。厳守事項:
- 数字（市場規模、成長率、価格、原価、販売目標、試験結果など）はデータにあるものだけを使う。データにない数字は作らず「【要確認】」と書く。
- 市場・競合・規制の記述には、データ内の source と url を sources に必ず付ける。データにない市場情報は書かない。
- 配合量（%）は社外秘なので書かない。
- 各ページ: title（20字以内）、lead（結論を1文、60字以内）、bullets（3〜6項目、各60字以内）、sources（[{label,url}]）。
- ページ構成は次の key の順で必ず10ページ: ${SLIDE_KEYS.map(([k, t]) => `${k}=${t}`).join(", ")}。
- cover の bullets には案件名・カテゴリ・販売市場・作成日(${today()})を入れる。summary は何を・なぜ今・いくらで・いつまでに。roadmap にはリスク（規制・原料調達・為替・品質）と対策、次のアクション。
JSONのみで返答: {"title": string, "subtitle": string, "slides":[{"key":"cover","title":"","lead":"","bullets":[],"sources":[]}]}

データ:
${JSON.stringify(input)}`, { effort: "high" });
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
      P.plan = { title: String(plan.title || p.name), subtitle: String(plan.subtitle || ""), date: today(), slides };
      const { error } = await sb.from("plans").upsert({ project_id: p.id, plan: P.plan }); if (error) throw error;
      toast("完了：企画書ができました", "PowerPoint・Word ボタンから保存できます。"); adminProject(p.id, "plan");
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
    if (fromLogin && pendingHash) { const x = pendingHash; pendingHash = null; if (location.hash !== x) { location.hash = x; return; } }
    if (!S.profile) { app.innerHTML = `<div class="card">Your account is being set up. Please reload in a moment. / アカウントを準備中です。</div>`; return; }
    $("topbar").hidden = false;
    $("me-name").textContent = (S.profile.full_name || S.profile.email || "") + (S.company ? ` — ${S.company.name}` : "");
    const parts = h.slice(2).split("/");
    if (S.isAdmin) {
      nav([["#/", "マスター画面"], ["#/companies", "登録企業"], ["#/translate", "翻訳ツール"], ["#/settings", "設定"]]);
      if (parts[0] === "p" && parts[1]) return adminProject(parts[1], parts[2]);
      if (parts[0] === "companies") return adminCompanies();
      if (parts[0] === "settings") return adminSettings();
      if (parts[0] === "translate") return viewTranslate();
      return adminHome();
    }
    nav([["#/", "Requests / Permintaan"], ["#/company", "Company / Perusahaan"], ["#/translate", "Translate / Terjemahan"]]);
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
