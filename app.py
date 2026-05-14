import streamlit as st
import plotly.graph_objects as go
from datetime import date

st.set_page_config(
    page_title="BIOT Capital Structure Simulator",
    page_icon="📊",
    layout="wide"
)

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
        "yk_sub": "$3M プリペイド — 締結禁止",
        "conv18": "転換価格（18%割引）",
        "conv30": "転換価格（30%割引）",
        "shares": "発行株数",
        "dilution": "希薄化率",
        "roth_price": "取引価格（97% VWAP）",
        "roth_cap": "19.99%キャップ到達額",
        "roth_cost": "コスト",
        "roth_control": "発行者コントロール",
        "roth_control_val": "完全",
        "yk_conv": "転換価格（7%割引）",
        "yk_floor": "フロア価格",
        "yk_floor_val": "$1.00（固定）",
        "yk_amort": "月次償還（VWAP<$1）",
        "yk_annual": "年換算 vs 売上",
        "yk_annual_val": "売上の430%",
        "go": "✅ GO",
        "nogo": "❌ NO GO",
        "kw_bar": "Kadenwood 18%",
        "kw_bar2": "Kadenwood 30%",
        "yk_bar": "Yorkville",
        "fault1_title": "欠陥①：投資家が転換タイミングを支配",
        "fault1_body": "Term sheetには「投資家がいつでも自由裁量でPurchase Noticeを発行できる」と明記。会社側に拒否権はなく、希薄化のタイミングをYorkvilleが一方的に決定する。これはRothの「発行者完全コントロール」と正反対の構造。",
        "fault2_title": "欠陥②：Amortisation Event — 会社存続の脅威",
        "fault2_body": "VWAPが$1.00（上場価格の10%）を5営業日/7営業日下回ると、毎月$802,500の現金支払いが発生（7%プレミアム付き）。FY2025売上$2.24Mに対し年換算$9.63M — 売上の430%。一度発動すれば会社のキャッシュフローを即座に破綻させる。",
        "fault3_title": "欠陥③：VRT禁止条項がRoth CEFを消滅させる",
        "fault3_body": "Yorkvilleの残高がある間、他社との Variable Rate Transaction（ATM含む）が全面禁止。署名した瞬間に$50MのRoth CEFが永久に失われる。Yorkvilleの$3Mを取るためにRothの$50Mを捨てることになる。",
        "stack_title": "推奨資本スタック",
        "stack_pre": "上場前",
        "stack_post": "上場後",
        "stack_opt": "上場後（オプション）",
        "stack_kw": "Kadenwood $5M転換社債",
        "stack_kw_detail": "上場と同時に転換。180日ロックアップ付き。コスト28〜42%だが唯一の上場前調達手段。",
        "stack_roth": "Roth $50M CEF",
        "stack_roth_detail": "上場後に発行者が自由に引出。コスト約5%。19.99%キャップ内で最大$50Mを柔軟調達。",
        "stack_yk": "Yorkville SEPA（再交渉後のみ）",
        "stack_yk_detail": "プリペイド条項を削除、Roth VRT除外条項を追加した場合のみ検討可。現状の条件では署名禁止。",
        "stack_token": "ICO / トークンレイズ（並行）",
        "stack_token_detail": "BioTrustプロトコルトークン。株式希薄化ゼロ。NASDAQ株価と独立して$50M+の調達が可能。",
        "summary_title": "経営判断サマリー",
        "summary1": "🔴 Yorkvilleのterm sheetに署名しない — 現状条件は会社存続リスク",
        "summary2": "🟢 Kadenwoodの締結を最優先 — 6月2日クローズに向けて今週中に動く",
        "summary3": "🟢 Roth CEFの手続きを並行開始 — 上場後10営業日以内にS-1提出",
        "summary4": "🟡 Yorkvilleとの再交渉は上場後 — プリペイド削除・Roth除外条項が条件",
        "summary5": "🔵 トークンレイズを並行トラックで検討 — 株式希薄化なしの補完調達",
        "timeline_title": "タイムライン & 緊急アクション",
        "days_label": "Kadenwood締切まで",
        "days_unit": "日",
        "action_now": "🚨 今すぐ（今週中）",
        "action_now1": "Kadenwoodのエンゲージメントレターに署名（5月5〜7日の期限を既に過過。即時対応が必要）",
        "action_now2": "Yorkvilleへ「プリペイド条項の削除」「Roth VRT除外」を条件に再交渉を通知",
        "action_now3": "Roth CEFの準備書類作成を開始",
        "action_may": "📅 5月中",
        "action_may1": "Kadenwoodの最終条件確定・クロージング準備",
        "action_may2": "Roth CEF署名",
        "action_may3": "トークンレイズのロードマップ策定",
        "action_jun": "📅 6月",
        "action_jun1": "Kadenwood $5Mクローズ（6月2日目標）",
        "action_jun2": "NASDAQ上場承認",
        "action_post": "📅 上場後",
        "action_post1": "Roth CEF開始 — S-1提出（上場後10営業日以内）",
        "action_post2": "Yorkville再交渉（条件付き）",
        "zone_danger": "⚠️ 深刻な希薄化ゾーン。全転換社債で株主価値の大幅毀損。Yorkvilleは絶対回避。",
        "zone_watch": "⚠️ 注意ゾーン。KadenwoodとYorkvilleの希薄化率が上昇。Rothは発行者コントロール維持。",
        "zone_good": "✅ 良好ゾーン。全転換で希薄化率が低水準。上場後の株価維持が最重要課題。",
        "zone_normal": "✅ 標準ゾーン（上場想定$10付近）。Kadenwood + Roth の推奨スタックが最適解。",
        "amort_warning": "⚠️ この株価帯はAmortisation Eventリスクゾーン。Yorkvilleは絶対に署名禁止。",
        "footer": "Instinct Brothers Holdings | 資本構成分析 | 社外秘 | May 2026",
        "scenario_title": "📈 株価シナリオ別 経営インパクト",
        "scenario_bear": "弱気シナリオ（$2〜$5）",
        "scenario_base": "ベースシナリオ（$8〜$12）",
        "scenario_bull": "強気シナリオ（$15〜$25）",
        "scenario_bear_body": "Yorkville Amortisation Eventのリスクが現実化。月次$802,500の支払いで資金繰り即時破綻。Kadenwoodの希薄化率も15〜20%超。この株価帯でYorkvilleに署名することは会社消滅を意味する。",
        "scenario_base_body": "推奨スタック（Kadenwood+Roth）が最大効果を発揮。希薄化率3〜5%に抑制。Rothの19.99%キャップで$29〜$35Mの低コスト調達が可能。上場成功の標準シナリオ。",
        "scenario_bull_body": "全ての転換社債で希薄化率が2〜3%以下に収束。Roth CEFのキャップ到達額が$43M超。トークンレイズとの相乗効果で$100M+の資本調達ポートフォリオが完成。",
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
        "conv18": "Conv. Price (18% discount)",
        "conv30": "Conv. Price (30% discount)",
        "shares": "Shares Issued",
        "dilution": "Dilution",
        "roth_price": "Trade Price (97% VWAP)",
        "roth_cap": "19.99% Cap Amount",
        "roth_cost": "All-in Cost",
        "roth_control": "Issuer Control",
        "roth_control_val": "Full",
        "yk_conv": "Conv. Price (7% discount)",
        "yk_floor": "Floor Price",
        "yk_floor_val": "$1.00 (fixed)",
        "yk_amort": "Monthly Amort. (VWAP<$1)",
        "yk_annual": "Annualized vs Revenue",
        "yk_annual_val": "430% of annual revenue",
        "go": "✅ GO",
        "nogo": "❌ NO GO",
        "kw_bar": "Kadenwood 18%",
        "kw_bar2": "Kadenwood 30%",
        "yk_bar": "Yorkville",
        "fault1_title": "Flaw ①: Investor Controls Conversion Timing",
        "fault1_body": "The term sheet explicitly states the investor may issue Purchase Notices at their sole discretion at any time. The company cannot refuse. Yorkville unilaterally decides when dilution occurs — the exact opposite of Roth's full issuer control structure.",
        "fault2_title": "Flaw ②: Amortisation Event — Existential Threat",
        "fault2_body": "If VWAP drops below $1.00 (10% of listing price) for 5 of 7 consecutive trading days, the company owes $802,500/month in cash plus a 7% premium. Against FY2025 revenue of $2.24M, the annualized obligation is $9.63M — 430% of annual revenue. One sustained event destroys cash flow immediately.",
        "fault3_title": "Flaw ③: VRT Prohibition Kills Roth CEF",
        "fault3_body": "Signing Yorkville prohibits any Variable Rate Transaction with any third party — including ATM facilities — while any balance remains outstanding. Signing Yorkville permanently eliminates the $50M Roth CEF. You would be trading $3M for the permanent loss of $50M in low-cost capital.",
        "stack_title": "Recommended Capital Stack",
        "stack_pre": "Pre-Listing",
        "stack_post": "Post-Listing",
        "stack_opt": "Post-Listing (Optional)",
        "stack_kw": "Kadenwood $5M Convertible Note",
        "stack_kw_detail": "Converts at NASDAQ listing. 180-day lock-up. All-in cost 28–42% but the only viable pre-listing funding option.",
        "stack_roth": "Roth $50M CEF",
        "stack_roth_detail": "Issuer-controlled draws post-listing. ~5% all-in cost. Up to $50M flexible capital within the 19.99% exchange cap.",
        "stack_yk": "Yorkville SEPA (renegotiated only)",
        "stack_yk_detail": "Only viable if Pre-Paid tranche is removed AND Roth is explicitly carved out from VRT prohibition. Current terms: do not sign.",
        "stack_token": "ICO / Token Raise (parallel track)",
        "stack_token_detail": "BioTrust Protocol token. Zero equity dilution. $50M+ raise potential, independent of NASDAQ stock price.",
        "summary_title": "Management Decision Summary",
        "summary1": "🔴 Do NOT sign Yorkville term sheet — current terms pose existential risk",
        "summary2": "🟢 Prioritize Kadenwood close — execute engagement letter this week, target June 2",
        "summary3": "🟢 Initiate Roth CEF process in parallel — S-1 filing within 10 business days of listing",
        "summary4": "🟡 Renegotiate Yorkville post-listing only — remove Pre-Paid, add Roth carve-out",
        "summary5": "🔵 Pursue token raise as parallel track — zero equity dilution supplementary capital",
        "timeline_title": "Timeline & Urgent Actions",
        "days_label": "Days to Kadenwood Deadline",
        "days_unit": "days",
        "action_now": "🚨 Immediate (This Week)",
        "action_now1": "Sign Kadenwood engagement letter (May 5–7 target already missed — immediate action required)",
        "action_now2": "Notify Yorkville of renegotiation conditions: remove Pre-Paid, add Roth VRT carve-out",
        "action_now3": "Begin preparation of Roth CEF documentation",
        "action_may": "📅 May",
        "action_may1": "Finalize Kadenwood terms and closing preparation",
        "action_may2": "Sign Roth CEF agreement",
        "action_may3": "Develop token raise roadmap",
        "action_jun": "📅 June",
        "action_jun1": "Kadenwood $5M close (target: June 2)",
        "action_jun2": "NASDAQ listing approval",
        "action_post": "📅 Post-Listing",
        "action_post1": "Roth CEF commences — S-1 filed within 10 business days",
        "action_post2": "Yorkville renegotiation (conditional)",
        "zone_danger": "⚠️ Critical dilution zone. Severe shareholder value destruction across all instruments. Yorkville is absolutely prohibited.",
        "zone_watch": "⚠️ Caution zone. Kadenwood and Yorkville dilution rising. Roth maintains full issuer control.",
        "zone_good": "✅ Strong zone. Low dilution across all instruments. Post-listing stock price defense is the top priority.",
        "zone_normal": "✅ Base zone (near $10 listing price). Kadenwood + Roth recommended stack is optimal.",
        "amort_warning": "⚠️ This price range enters Amortisation Event risk territory. Yorkville signing is absolutely prohibited.",
        "footer": "Instinct Brothers Holdings | Capital Structure Analysis | Strictly Confidential | May 2026",
        "scenario_title": "📈 Stock Price Scenario Analysis",
        "scenario_bear": "Bear Scenario ($2–$5)",
        "scenario_base": "Base Scenario ($8–$12)",
        "scenario_bull": "Bull Scenario ($15–$25)",
        "scenario_bear_body": "Yorkville Amortisation Event risk becomes real. Monthly $802,500 payments immediately destroy cash flow. Kadenwood dilution exceeds 15–20%. Signing Yorkville in this price range means company insolvency.",
        "scenario_base_body": "Recommended stack (Kadenwood + Roth) performs optimally. Dilution held to 3–5%. Roth 19.99% cap enables $29–$35M in low-cost capital. Standard successful listing scenario.",
        "scenario_bull_body": "All convertible instruments converge below 2–3% dilution. Roth CEF cap reaches $43M+. Combined with token raise, a $100M+ capital portfolio is achievable.",
    }
}

# Language toggle
col_lang1, col_lang2 = st.columns([8,1])
with col_lang2:
    if st.button("🇯🇵 JP / 🇺🇸 EN"):
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
roth_price = price * 0.97
roth_shares = int(ROTH_DRAW / roth_price)
roth_cap_amt = int(SHARES_OUT * ROTH_CAP) * price
yk_conv_raw = price * 0.93
yk_conv = max(yk_conv_raw, YK_FLOOR)
yk_shares = int(YK_AMOUNT / yk_conv)
yk_dil = dilution(yk_shares)

# Zone alert
if price < 2:
    st.error(t["zone_danger"])
elif price <= 5:
    st.warning(t["zone_watch"])
    if price <= 3:
        st.error(t["amort_warning"])
elif price >= 15:
    st.success(t["zone_good"])
else:
    st.info(t["zone_normal"])

st.subheader(t["section1"])
col1, col2, col3 = st.columns(3)

with col1:
    st.markdown(f"### {t['go']} {t['kw_title']}")
    st.caption(t["kw_sub"])
    st.markdown(f"**{t['conv18']}**")
    a, b, c = st.columns(3)
    a.metric(t["conv18"], f"${kw18_conv:.2f}")
    b.metric(t["shares"], f"{kw18_shares:,}")
    c.metric(t["dilution"], f"{kw18_dil:.1f}%")
    st.markdown(f"**{t['conv30']}**")
    d, e, f = st.columns(3)
    d.metric(t["conv30"], f"${kw30_conv:.2f}")
    e.metric(t["shares"], f"{kw30_shares:,}")
    f.metric(t["dilution"], f"{kw30_dil:.1f}%")
    st.success("Lock-up: 180 days post-listing")

with col2:
    st.markdown(f"### {t['go']} {t['roth_title']}")
    st.caption(t["roth_sub"])
    r1, r2 = st.columns(2)
    r1.metric(t["roth_price"], f"${roth_price:.2f}")
    r2.metric(t["shares"] + "/$10M", f"{roth_shares:,}")
    r3, r4 = st.columns(2)
    r3.metric(t["roth_cap"], f"${roth_cap_amt/1_000_000:.1f}M")
    r4.metric(t["roth_cost"], "~5%")
    st.success(f"{t['roth_control']}: {t['roth_control_val']}")

with col3:
    st.markdown(f"### {t['nogo']} {t['yk_title']}")
    st.caption(t["yk_sub"])
    floor_hit = yk_conv_raw <= YK_FLOOR
    y1, y2 = st.columns(2)
    y1.metric(t["yk_conv"], f"${yk_conv:.2f}", delta="Floor hit" if floor_hit else None, delta_color="inverse")
    y2.metric(t["shares"], f"{yk_shares:,}")
    y3, y4 = st.columns(2)
    y3.metric(t["yk_floor"], t["yk_floor_val"])
    y4.metric(t["yk_amort"], "$802,500")
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
    xaxis=dict(range=[0, 25], title="(%)", showgrid=True, gridcolor="#eee"),
    yaxis=dict(showgrid=False),
    plot_bgcolor="white", paper_bgcolor="white",
    height=200, margin=dict(l=10, r=60, t=10, b=30), font=dict(size=13)
)
st.plotly_chart(fig, use_container_width=True)

st.divider()
st.subheader(t["section3"])
c1, c2, c3 = st.columns(3)
with c1:
    st.error(f"**{t['fault1_title']}**")
    st.write(t["fault1_body"])
with c2:
    st.error(f"**{t['fault2_title']}**")
    st.write(t["fault2_body"])
    st.metric("$802,500 × 12", "$9,630,000/yr")
    st.metric("FY2025 Revenue", "$2,240,000")
with c3:
    st.error(f"**{t['fault3_title']}**")
    st.write(t["fault3_body"])
    st.metric("Yorkville Pre-Paid", "$3,000,000")
    st.metric("Roth CEF Lost", "$50,000,000")

st.divider()
st.subheader(t["section4"])
data = {
    "Stage": [t["stack_pre"], t["stack_post"], t["stack_opt"], "Parallel"],
    "Provider": [t["stack_kw"], t["stack_roth"], t["stack_yk"], t["stack_token"]],
    "Size": ["$5,000,000", "Up to $50M / 36mo", "Up to $150M", "$50M+ target"],
    "Cost": ["~28–42%", "~5%", "~5%", "Zero dilution"],
    "Status": ["🟢 PROCEED NOW", "🟢 INITIATE NOW", "🟡 RENEGOTIATE", "🔵 PARALLEL TRACK"],
    "Detail": [t["stack_kw_detail"], t["stack_roth_detail"], t["stack_yk_detail"], t["stack_token_detail"]]
}
for i in range(len(data["Stage"])):
    with st.expander(f"{data['Status'][i]}　{data['Provider'][i]} — {data['Size'][i]}"):
        st.write(data["Detail"][i])
        col_a, col_b = st.columns(2)
        col_a.metric("Size", data["Size"][i])
        col_b.metric("Cost", data["Cost"][i])

st.divider()
st.subheader(t["scenario_title"])
s1, s2, s3 = st.columns(3)
with s1:
    st.warning(f"**{t['scenario_bear']}**")
    st.write(t["scenario_bear_body"])
with s2:
    st.success(f"**{t['scenario_base']}**")
    st.write(t["scenario_base_body"])
with s3:
    st.info(f"**{t['scenario_bull']}**")
    st.write(t["scenario_bull_body"])

st.divider()
st.subheader(t["section5"])
for item in ["summary1","summary2","summary3","summary4","summary5"]:
    st.markdown(f"- {t[item]}")

st.divider()
st.subheader(t["section6"])
days_left = (DEADLINE - date.today()).days
col_days, col_msg = st.columns([1, 3])
col_days.metric(t["days_label"], f"{days_left} {t['days_unit']}", delta="URGENT" if days_left < 14 else None, delta_color="inverse")
col_msg.warning("Kadenwood engagement letter: May 5–7 target MISSED. Immediate action required.")

t1, t2, t3, t4 = st.tabs([t["action_now"], t["action_may"], t["action_jun"], t["action_post"]])
with t1:
    st.error(f"- {t['action_now1']}")
    st.error(f"- {t['action_now2']}")
    st.warning(f"- {t['action_now3']}")
with t2:
    st.info(f"- {t['action_may1']}")
    st.info(f"- {t['action_may2']}")
    st.info(f"- {t['action_may3']}")
with t3:
    st.success(f"- {t['action_jun1']}")
    st.success(f"- {t['action_jun2']}")
with t4:
    st.success(f"- {t['action_post1']}")
    st.info(f"- {t['action_post2']}")

st.divider()
st.caption(t["footer"])
