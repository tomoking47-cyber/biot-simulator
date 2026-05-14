import streamlit as st
import plotly.graph_objects as go
from datetime import date

st.set_page_config(
    page_title="BIOT Capital Structure Simulator",
    page_icon="📊",
    layout="centered"
)

st.markdown("""
<style>
/* ベースフォント：モバイルで読みやすいサイズ */
html, body, [class*="css"] {
    font-size: clamp(13px, 2.5vw, 16px) !important;
}
/* メトリックラベル */
[data-testid="stMetricLabel"] {
    font-size: clamp(10px, 2vw, 13px) !important;
    white-space: normal !important;
    word-break: break-word !important;
}
/* メトリック値 */
[data-testid="stMetricValue"] {
    font-size: clamp(14px, 3vw, 22px) !important;
}
/* カラム間隔を詰める */
[data-testid="column"] {
    padding: 0 4px !important;
}
/* テキストが枠からはみ出さないよう */
p, div, span, label {
    word-break: break-word !important;
    overflow-wrap: break-word !important;
}
/* タイトル */
h1 { font-size: clamp(18px, 4vw, 28px) !important; }
h2 { font-size: clamp(15px, 3vw, 22px) !important; }
h3 { font-size: clamp(13px, 2.5vw, 18px) !important; }
/* ボタン */
[data-testid="stButton"] button {
    font-size: clamp(11px, 2vw, 14px) !important;
    padding: 4px 10px !important;
    white-space: nowrap !important;
}
/* expander */
[data-testid="stExpander"] {
    font-size: clamp(12px, 2.2vw, 15px) !important;
}
/* タブ */
[data-testid="stTabs"] button {
    font-size: clamp(10px, 1.8vw, 13px) !important;
    padding: 4px 6px !important;
}
/* アラート */
[data-testid="stAlert"] {
    font-size: clamp(12px, 2vw, 14px) !important;
    padding: 8px 12px !important;
}
/* キャプション */
[data-testid="stCaptionContainer"] {
    font-size: clamp(10px, 1.8vw, 12px) !important;
}
</style>
""", unsafe_allow_html=True)

PASSWORD = "biot2026"
if "authenticated" not in st.session_state:
    st.session_state.authenticated = False
if "lang" not in st.session_state:
    st.session_state.lang = "JP"

if not st.session_state.authenticated:
    st.title("🔒 BIOT Capital Structure Simulator")
    pwd = st.text_input("Password / パスワード", type="password")
    if st.button("Login / ログイン"):
        if pwd == PASSWORD:
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("Wrong password / パスワードが違います")
    st.stop()

L = {
    "JP": {
        "title": "Instinct Brothers Holdings — 資本構成シミュレーター",
        "caption": "発行済株数 15,000,000株 ／ 上場予定価格 $10.00 ／ 社外秘",
        "slider": "株価 (USD)",
        "section1": "📊 3社比較",
        "section2": "📉 希薄化率 比較",
        "section3": "⚠️ Yorkville — 3つの致命的欠陥",
        "section4": "✅ 推奨資本スタック",
        "section5": "🎯 経営判断サマリー",
        "section6": "⏰ タイムライン & 緊急アクション",
        "kw_title": "Kadenwood Group",
        "kw_sub": "$5M 転換社債 — 上場前",
        "roth_title": "Roth Principal Investments",
        "roth_sub": "$50M CEF — 上場後（$10M引出時）",
        "yk_title": "Yorkville Advisors",
        "yk_sub": "$3M プリペイド — 署名禁止",
        "conv18": "転換価格(18%割引)",
        "conv30": "転換価格(30%割引)",
        "shares": "発行株数",
        "dilution": "希薄化率",
        "roth_price": "取引価格(97%VWAP)",
        "roth_cap": "キャップ到達額",
        "roth_cost": "コスト",
        "roth_control": "発行者コントロール",
        "roth_control_val": "完全",
        "yk_conv": "転換価格(7%割引)",
        "yk_floor": "フロア価格",
        "yk_floor_val": "$1.00（固定）",
        "yk_amort": "月次償還(VWAP<$1)",
        "yk_annual": "年換算 vs 売上",
        "yk_annual_val": "売上の430%",
        "go": "✅ GO",
        "nogo": "❌ NO GO",
        "kw_bar": "Kadenwood 18%",
        "kw_bar2": "Kadenwood 30%",
        "yk_bar": "Yorkville",
        "fault1_title": "欠陥①：投資家が転換タイミングを支配",
        "fault1_body": "Term sheetには「投資家がいつでも自由裁量でPurchase Noticeを発行できる」と明記。会社側に拒否権はなく、希薄化のタイミングをYorkvilleが一方的に決定する。Rothの「発行者完全コントロール」と正反対の構造。",
        "fault2_title": "欠陥②：Amortisation Event — 会社存続の脅威",
        "fault2_body": "VWAPが$1.00を5/7営業日下回ると毎月$802,500の現金支払いが発生。FY2025売上$2.24Mに対し年換算$9.63M — 売上の430%。一度発動すれば即座にキャッシュフロー破綻。",
        "fault3_title": "欠陥③：VRT禁止がRoth CEFを消滅させる",
        "fault3_body": "Yorkville残高がある間、他社とのVariable Rate Transaction（ATM含む）が全面禁止。署名した瞬間に$50MのRoth CEFが永久に失われる。$3Mのために$50Mを捨てることになる。",
        "stack_kw": "Kadenwood $5M転換社債",
        "stack_kw_detail": "上場と同時に転換。180日ロックアップ付き。唯一の上場前調達手段。コスト28〜42%。",
        "stack_roth": "Roth $50M CEF",
        "stack_roth_detail": "上場後に発行者が自由に引出。コスト約5%。19.99%キャップ内で最大$50Mを柔軟調達。",
        "stack_yk": "Yorkville SEPA（再交渉後のみ）",
        "stack_yk_detail": "プリペイド条項削除＋Roth VRT除外条項を追加した場合のみ検討可。現状条件では署名禁止。",
        "stack_token": "ICO / トークンレイズ（並行）",
        "stack_token_detail": "BioTrustプロトコルトークン。株式希薄化ゼロ。NASDAQ株価と独立して$50M+の調達が可能。",
        "summary1": "🔴 Yorkvilleのterm sheetに署名しない — 現状条件は会社存続リスク",
        "summary2": "🟢 Kadenwoodの締結を最優先 — 今週中にエンゲージメントレター署名",
        "summary3": "🟢 Roth CEFの手続きを並行開始 — 上場後10営業日以内にS-1提出",
        "summary4": "🟡 Yorkvilleとの再交渉は上場後 — プリペイド削除・Roth除外条項が条件",
        "summary5": "🔵 トークンレイズを並行トラックで検討 — 株式希薄化なしの補完調達",
        "days_label": "Kadenwood締切まで",
        "days_unit": "日",
        "action_now": "🚨 今すぐ",
        "action_may": "📅 5月中",
        "action_jun": "📅 6月",
        "action_post": "📅 上場後",
        "action_now1": "Kadenwoodのエンゲージメントレターに署名（5月5〜7日の期限を既に過超。即時対応が必要）",
        "action_now2": "Yorkvilleへ再交渉を通知（プリペイド削除・Roth VRT除外が条件）",
        "action_now3": "Roth CEFの準備書類作成を開始",
        "action_may1": "Kadenwoodの最終条件確定・クロージング準備",
        "action_may2": "Roth CEF署名",
        "action_may3": "トークンレイズのロードマップ策定",
        "action_jun1": "Kadenwood $5Mクローズ（6月2日目標）",
        "action_jun2": "NASDAQ上場承認",
        "action_post1": "Roth CEF開始 — S-1提出（上場後10営業日以内）",
        "action_post2": "Yorkville再交渉（条件付き）",
        "zone_danger": "⚠️ 深刻な希薄化ゾーン。全転換社債で株主価値が大幅毀損。Yorkvilleは絶対回避。",
        "zone_watch": "⚠️ 注意ゾーン。KadenwoodとYorkvilleの希薄化率が上昇。Rothは発行者コントロール維持。",
        "zone_good": "✅ 良好ゾーン。全転換で希薄化率が低水準。上場後の株価維持が最重要課題。",
        "zone_normal": "✅ 標準ゾーン（上場想定$10付近）。Kadenwood + Roth の推奨スタックが最適解。",
        "amort_warning": "⚠️ Amortisation Eventリスクゾーン。Yorkvilleへの署名は絶対禁止。",
        "scenario_title": "📈 株価シナリオ別 経営インパクト",
        "scenario_bear": "🔴 弱気（$2〜$5）",
        "scenario_base": "🟢 標準（$8〜$12）",
        "scenario_bull": "🔵 強気（$15〜$25）",
        "scenario_bear_body": "Yorkville Amortisation Eventのリスクが現実化。月次$802,500の支払いで資金繰り即時破綻。Kadenwoodの希薄化率も15〜20%超。この株価帯でYorkvilleに署名することは会社消滅を意味する。",
        "scenario_base_body": "推奨スタック（Kadenwood+Roth）が最大効果を発揮。希薄化率3〜5%に抑制。Rothの19.99%キャップで$29〜$35Mの低コスト調達が可能。上場成功の標準シナリオ。",
        "scenario_bull_body": "全転換社債で希薄化率が2〜3%以下に収束。Roth CEFのキャップ到達額が$43M超。トークンレイズとの相乗効果で$100M+の資本調達ポートフォリオが完成。",
        "stack_pre": "上場前",
        "stack_post": "上場後",
        "stack_opt": "上場後（オプション）",
        "footer": "Instinct Brothers Holdings | 資本構成分析 | 社外秘 | May 2026",
        "lang_btn": "🇺🇸 English",
    },
    "EN": {
        "title": "Instinct Brothers Holdings — Capital Structure Simulator",
        "caption": "15,000,000 shares outstanding ／ Expected listing price $10.00 ／ CONFIDENTIAL",
        "slider": "Stock Price (USD)",
        "section1": "📊 Three-Party Comparison",
        "section2": "📉 Dilution Comparison",
        "section3": "⚠️ Yorkville — Three Fatal Flaws",
        "section4": "✅ Recommended Capital Stack",
        "section5": "🎯 Management Decision Summary",
        "section6": "⏰ Timeline & Urgent Actions",
        "kw_title": "Kadenwood Group",
        "kw_sub": "$5M Convertible Note — Pre-Listing",
        "roth_title": "Roth Principal Investments",
        "roth_sub": "$50M CEF — Post-Listing (per $10M draw)",
        "yk_title": "Yorkville Advisors",
        "yk_sub": "$3M Pre-Paid — DO NOT SIGN",
        "conv18": "Conv.(18% disc.)",
        "conv30": "Conv.(30% disc.)",
        "shares": "Shares",
        "dilution": "Dilution",
        "roth_price": "Price(97%VWAP)",
        "roth_cap": "Cap Amount",
        "roth_cost": "All-in Cost",
        "roth_control": "Issuer Control",
        "roth_control_val": "Full",
        "yk_conv": "Conv.(7% disc.)",
        "yk_floor": "Floor Price",
        "yk_floor_val": "$1.00 (fixed)",
        "yk_amort": "Monthly Amort.",
        "yk_annual": "Annual vs Revenue",
        "yk_annual_val": "430% of revenue",
        "go": "✅ GO",
        "nogo": "❌ NO GO",
        "kw_bar": "Kadenwood 18%",
        "kw_bar2": "Kadenwood 30%",
        "yk_bar": "Yorkville",
        "fault1_title": "Flaw ①: Investor Controls Conversion",
        "fault1_body": "The term sheet states the investor may issue Purchase Notices at sole discretion at any time. The company cannot refuse. Yorkville decides when dilution occurs — the opposite of Roth's full issuer control.",
        "fault2_title": "Flaw ②: Amortisation Event — Existential",
        "fault2_body": "VWAP below $1.00 for 5/7 trading days triggers $802,500/month cash payments plus 7% premium. Against FY2025 revenue of $2.24M, annualized obligation is $9.63M — 430% of revenue. One event destroys cash flow immediately.",
        "fault3_title": "Flaw ③: VRT Prohibition Kills Roth CEF",
        "fault3_body": "Signing Yorkville prohibits any Variable Rate Transaction while balance remains. Signing Yorkville permanently eliminates the $50M Roth CEF. You trade $3M for the permanent loss of $50M.",
        "stack_kw": "Kadenwood $5M Convertible Note",
        "stack_kw_detail": "Converts at NASDAQ listing. 180-day lock-up. Only viable pre-listing option. All-in cost 28–42%.",
        "stack_roth": "Roth $50M CEF",
        "stack_roth_detail": "Issuer-controlled draws post-listing. ~5% all-in cost. Up to $50M within the 19.99% exchange cap.",
        "stack_yk": "Yorkville SEPA (renegotiated only)",
        "stack_yk_detail": "Only viable if Pre-Paid is removed AND Roth is carved out from VRT prohibition. Current terms: do not sign.",
        "stack_token": "ICO / Token Raise (parallel)",
        "stack_token_detail": "BioTrust Protocol token. Zero equity dilution. $50M+ raise, independent of NASDAQ stock price.",
        "summary1": "🔴 Do NOT sign Yorkville — current terms pose existential risk",
        "summary2": "🟢 Prioritize Kadenwood close — sign engagement letter this week",
        "summary3": "🟢 Initiate Roth CEF in parallel — S-1 within 10 business days of listing",
        "summary4": "🟡 Renegotiate Yorkville post-listing only — remove Pre-Paid, add Roth carve-out",
        "summary5": "🔵 Pursue token raise as parallel track — zero equity dilution",
        "days_label": "Days to Kadenwood Deadline",
        "days_unit": "days",
        "action_now": "🚨 Now",
        "action_may": "📅 May",
        "action_jun": "📅 June",
        "action_post": "📅 Post-Listing",
        "action_now1": "Sign Kadenwood engagement letter (May 5–7 target MISSED — immediate action required)",
        "action_now2": "Notify Yorkville of renegotiation conditions: remove Pre-Paid, add Roth VRT carve-out",
        "action_now3": "Begin Roth CEF documentation preparation",
        "action_may1": "Finalize Kadenwood terms and closing preparation",
        "action_may2": "Sign Roth CEF agreement",
        "action_may3": "Develop token raise roadmap",
        "action_jun1": "Kadenwood $5M close (target: June 2)",
        "action_jun2": "NASDAQ listing approval",
        "action_post1": "Roth CEF commences — S-1 filed within 10 business days",
        "action_post2": "Yorkville renegotiation (conditional)",
        "zone_danger": "⚠️ Critical dilution zone. Severe value destruction across all instruments. Yorkville absolutely prohibited.",
        "zone_watch": "⚠️ Caution zone. Kadenwood and Yorkville dilution rising. Roth maintains full issuer control.",
        "zone_good": "✅ Strong zone. Low dilution across all instruments. Post-listing stock price defense is top priority.",
        "zone_normal": "✅ Base zone (near $10 listing price). Kadenwood + Roth recommended stack is optimal.",
        "amort_warning": "⚠️ Amortisation Event risk zone. Signing Yorkville is absolutely prohibited.",
        "scenario_title": "📈 Stock Price Scenario Analysis",
        "scenario_bear": "🔴 Bear ($2–$5)",
        "scenario_base": "🟢 Base ($8–$12)",
        "scenario_bull": "🔵 Bull ($15–$25)",
        "scenario_bear_body": "Yorkville Amortisation Event risk becomes real. Monthly $802,500 payments immediately destroy cash flow. Kadenwood dilution exceeds 15–20%. Signing Yorkville in this range means insolvency.",
        "scenario_base_body": "Recommended stack (Kadenwood + Roth) performs optimally. Dilution held to 3–5%. Roth cap enables $29–$35M in low-cost capital. Standard successful listing scenario.",
        "scenario_bull_body": "All instruments converge below 2–3% dilution. Roth CEF cap reaches $43M+. Combined with token raise, a $100M+ capital portfolio is achievable.",
        "stack_pre": "Pre-Listing",
        "stack_post": "Post-Listing",
        "stack_opt": "Post-Listing (Optional)",
        "footer": "Instinct Brothers Holdings | Capital Structure Analysis | Strictly Confidential | May 2026",
        "lang_btn": "🇯🇵 日本語",
    }
}

col_title, col_lang = st.columns([5, 1])
with col_lang:
    if st.button(L[st.session_state.lang]["lang_btn"]):
        st.session_state.lang = "EN" if st.session_state.lang == "JP" else "JP"
        st.rerun()

t = L[st.session_state.lang]

SHARES_OUT = 15_000_000
KW_AMOUNT = 5_000_000
ROTH_DRAW = 10_000_000
ROTH_CAP = 0.1999
YK_AMOUNT = 3_000_000
YK_FLOOR = 1.00
DEADLINE = date(2026, 6, 2)

def dilution(new_shares):
    return (new_shares / (SHARES_OUT + new_shares)) * 100

with col_title:
    st.title(f"📊 {t['title']}")
st.caption(t["caption"])
st.divider()

price = st.slider(t["slider"], min_value=1.0, max_value=25.0, value=10.0, step=0.5, format="$%.2f")

kw18_conv = price * 0.82
kw18_shares = int(KW_AMOUNT / kw18_conv)
kw18_dil = dilution(kw18_shares)
kw30_conv = price * 0.70
kw30_shares = int(KW_AMOUNT / kw30_conv)
kw30_dil = dilution(kw30_shares)
roth_price_val = price * 0.97
roth_shares = int(ROTH_DRAW / roth_price_val)
roth_cap_amt = int(SHARES_OUT * ROTH_CAP) * price
yk_conv_raw = price * 0.93
yk_conv = max(yk_conv_raw, YK_FLOOR)
yk_shares = int(YK_AMOUNT / yk_conv)
yk_dil = dilution(yk_shares)

if price < 2:
    st.error(t["zone_danger"])
elif price <= 3:
    st.warning(t["zone_watch"])
    st.error(t["amort_warning"])
elif price <= 5:
    st.warning(t["zone_watch"])
elif price >= 15:
    st.success(t["zone_good"])
else:
    st.info(t["zone_normal"])

st.subheader(t["section1"])

# Kadenwood
with st.expander(f"{t['go']} {t['kw_title']} — {t['kw_sub']}", expanded=True):
    c1, c2, c3 = st.columns(3)
    c1.metric(t["conv18"], f"${kw18_conv:.2f}")
    c2.metric(t["shares"], f"{kw18_shares:,}")
    c3.metric(t["dilution"], f"{kw18_dil:.1f}%")
    c4, c5, c6 = st.columns(3)
    c4.metric(t["conv30"], f"${kw30_conv:.2f}")
    c5.metric(t["shares"], f"{kw30_shares:,}")
    c6.metric(t["dilution"], f"{kw30_dil:.1f}%")
    st.success("Lock-up: 180 days post-listing")

# Roth
with st.expander(f"{t['go']} {t['roth_title']} — {t['roth_sub']}", expanded=True):
    r1, r2, r3 = st.columns(3)
    r1.metric(t["roth_price"], f"${roth_price_val:.2f}")
    r2.metric(t["shares"] + "/$10M", f"{roth_shares:,}")
    r3.metric(t["roth_cap"], f"${roth_cap_amt/1_000_000:.1f}M")
    r4, r5 = st.columns(2)
    r4.metric(t["roth_cost"], "~5%")
    r5.metric(t["roth_control"], t["roth_control_val"])

# Yorkville
with st.expander(f"{t['nogo']} {t['yk_title']} — {t['yk_sub']}", expanded=True):
    floor_hit = yk_conv_raw <= YK_FLOOR
    y1, y2, y3 = st.columns(3)
    y1.metric(t["yk_conv"], f"${yk_conv:.2f}", delta="Floor!" if floor_hit else None, delta_color="inverse")
    y2.metric(t["shares"], f"{yk_shares:,}")
    y3.metric(t["yk_amort"], "$802,500")
    st.error(f"{t['yk_annual']}: {t['yk_annual_val']}")

st.divider()
st.subheader(t["section2"])
fig = go.Figure()
cats = [t["kw_bar"], t["kw_bar2"], t["yk_bar"]]
vals = [kw18_dil, kw30_dil, yk_dil]
colors = ["#1D9E75", "#0F6E56", "#E24B4A"]
fig.add_trace(go.Bar(
    x=vals, y=cats, orientation='h',
    marker_color=colors,
    text=[f"{v:.1f}%" for v in vals],
    textposition='outside', width=0.5
))
fig.update_layout(
    xaxis=dict(range=[0, 28], showgrid=True, gridcolor="#eee"),
    yaxis=dict(showgrid=False),
    plot_bgcolor="white", paper_bgcolor="white",
    height=180, margin=dict(l=10, r=50, t=5, b=20),
    font=dict(size=11)
)
st.plotly_chart(fig, use_container_width=True)

st.divider()
st.subheader(t["section3"])
with st.expander(f"⚠️ {t['fault1_title']}"):
    st.write(t["fault1_body"])
with st.expander(f"⚠️ {t['fault2_title']}"):
    st.write(t["fault2_body"])
    f1, f2 = st.columns(2)
    f1.metric("$802,500 × 12", "$9,630,000/yr")
    f2.metric("FY2025 Revenue", "$2,240,000")
with st.expander(f"⚠️ {t['fault3_title']}"):
    st.write(t["fault3_body"])
    f3, f4 = st.columns(2)
    f3.metric("Yorkville Pre-Paid", "$3M")
    f4.metric("Roth CEF Lost", "$50M")

st.divider()
st.subheader(t["section4"])
stack_items = [
    (t["stack_pre"], "🟢", t["stack_kw"], "$5M", "28–42%", "PROCEED NOW", t["stack_kw_detail"]),
    (t["stack_post"], "🟢", t["stack_roth"], "$50M", "~5%", "INITIATE NOW", t["stack_roth_detail"]),
    (t["stack_opt"], "🟡", t["stack_yk"], "$150M", "~5%", "RENEGOTIATE", t["stack_yk_detail"]),
    ("Parallel", "🔵", t["stack_token"], "$50M+", "0%", "PARALLEL", t["stack_token_detail"]),
]
for stage, icon, name, size, cost, status, detail in stack_items:
    with st.expander(f"{icon} {status} — {name} ({size})"):
        st.write(detail)
        s1, s2, s3 = st.columns(3)
        s1.metric("Stage", stage)
        s2.metric("Size", size)
        s3.metric("Cost", cost)

st.divider()
st.subheader(t["scenario_title"])
with st.expander(t["scenario_bear"]):
    st.write(t["scenario_bear_body"])
with st.expander(t["scenario_base"]):
    st.write(t["scenario_base_body"])
with st.expander(t["scenario_bull"]):
    st.write(t["scenario_bull_body"])

st.divider()
st.subheader(t["section5"])
for key in ["summary1","summary2","summary3","summary4","summary5"]:
    st.markdown(f"- {t[key]}")

st.divider()
st.subheader(t["section6"])
days_left = (DEADLINE - date.today()).days
d1, d2 = st.columns([1, 2])
d1.metric(t["days_label"], f"{days_left} {t['days_unit']}", delta="URGENT", delta_color="inverse")
d2.warning("Kadenwood engagement letter: May 5–7 MISSED. Act now.")

tabs = st.tabs([t["action_now"], t["action_may"], t["action_jun"], t["action_post"]])
with tabs[0]:
    st.error(f"- {t['action_now1']}")
    st.error(f"- {t['action_now2']}")
    st.warning(f"- {t['action_now3']}")
with tabs[1]:
    st.info(f"- {t['action_may1']}")
    st.info(f"- {t['action_may2']}")
    st.info(f"- {t['action_may3']}")
with tabs[2]:
    st.success(f"- {t['action_jun1']}")
    st.success(f"- {t['action_jun2']}")
with tabs[3]:
    st.success(f"- {t['action_post1']}")
    st.info(f"- {t['action_post2']}")

st.divider()
st.caption(t["footer"])
