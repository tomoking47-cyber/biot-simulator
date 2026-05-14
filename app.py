import streamlit as st
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import pandas as pd
from datetime import date

st.set_page_config(page_title="BIOT Capital Simulator", page_icon="📊", layout="centered")

st.markdown("""
<style>
html, body, [class*="css"] { font-size: clamp(12px, 2.5vw, 15px) !important; }
[data-testid="stMetricLabel"] { font-size: clamp(10px, 1.8vw, 12px) !important; white-space: normal !important; word-break: break-word !important; }
[data-testid="stMetricValue"] { font-size: clamp(13px, 2.8vw, 20px) !important; }
[data-testid="column"] { padding: 0 3px !important; }
p, div, span, label { word-break: break-word !important; overflow-wrap: break-word !important; }
h1 { font-size: clamp(16px, 3.5vw, 26px) !important; }
h2 { font-size: clamp(14px, 2.8vw, 20px) !important; }
h3 { font-size: clamp(12px, 2.2vw, 16px) !important; }
[data-testid="stButton"] button { font-size: clamp(11px, 1.8vw, 13px) !important; }
[data-testid="stAlert"] { font-size: clamp(11px, 1.8vw, 13px) !important; padding: 6px 10px !important; }
[data-testid="stTabs"] button { font-size: clamp(10px, 1.6vw, 12px) !important; padding: 3px 5px !important; }
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

JP = "JP"
EN = "EN"
lang = st.session_state.lang

T = {
    "title":          {"JP": "BIOT 資本構成シミュレーター", "EN": "BIOT Capital Structure Simulator"},
    "caption":        {"JP": "発行済株数 15,000,000株 ／ 上場予定価格 $10.00 ／ 社外秘", "EN": "15,000,000 shares ／ Listing price $10.00 ／ CONFIDENTIAL"},
    "slider":         {"JP": "株価 (USD)", "EN": "Stock Price (USD)"},
    "tab1":           {"JP": "📊 希薄化分析", "EN": "📊 Dilution"},
    "tab2":           {"JP": "💰 コスト比較", "EN": "💰 Cost Compare"},
    "tab3":           {"JP": "📈 シナリオ予測", "EN": "📈 Scenarios"},
    "tab4":           {"JP": "⚠️ リスク分析", "EN": "⚠️ Risk Analysis"},
    "tab5":           {"JP": "🎯 意思決定", "EN": "🎯 Decision"},
    "tab6":           {"JP": "🏦 CHARDAN分析", "EN": "🏦 CHARDAN"},
    "lang_btn":       {"JP": "🇺🇸 EN", "EN": "🇯🇵 JP"},
    "dil_title":      {"JP": "株価別 希薄化率", "EN": "Dilution by Stock Price"},
    "dil_note":       {"JP": "スライダーを動かすと現在株価の位置が赤線で表示されます", "EN": "Move the slider to see current price marked with red line"},
    "cost_title":     {"JP": "3社 コスト・条件比較", "EN": "3-Party Cost & Terms Comparison"},
    "scenario_title": {"JP": "時価総額シナリオ予測（上場〜5年後）", "EN": "Market Cap Scenario Forecast (Listing to 5 Years)"},
    "risk_title":     {"JP": "Yorkville リスクシミュレーション", "EN": "Yorkville Risk Simulation"},
    "amort_title":    {"JP": "Amortisation Event 発動シミュレーション", "EN": "Amortisation Event Trigger Simulation"},
    "capital_title":  {"JP": "推奨スタック 調達可能額", "EN": "Recommended Stack — Capital Available"},
    "decision_title": {"JP": "経営判断サマリー", "EN": "Management Decision Summary"},
    "go":             {"JP": "✅ GO", "EN": "✅ GO"},
    "nogo":           {"JP": "❌ NO GO", "EN": "❌ NO GO"},
    "bear":           {"JP": "🔴 弱気シナリオ", "EN": "🔴 Bear"},
    "base":           {"JP": "🟢 標準シナリオ", "EN": "🟢 Base"},
    "bull":           {"JP": "🔵 強気シナリオ", "EN": "🔵 Bull"},
    "mktcap":         {"JP": "時価総額 ($M)", "EN": "Market Cap ($M)"},
    "year":           {"JP": "年", "EN": "Year"},
    "zone_danger":    {"JP": "⚠️ 深刻ゾーン：全転換社債で株主価値が大幅毀損。Yorkvilleは絶対回避。", "EN": "⚠️ Critical: Severe value destruction. Yorkville absolutely prohibited."},
    "zone_watch":     {"JP": "⚠️ 注意ゾーン：希薄化率が上昇中。Rothは発行者コントロール維持。", "EN": "⚠️ Caution: Dilution rising. Roth maintains issuer control."},
    "zone_good":      {"JP": "✅ 良好ゾーン：希薄化率が低水準。上場後の株価維持が最重要。", "EN": "✅ Strong: Low dilution. Post-listing price defense is top priority."},
    "zone_normal":    {"JP": "✅ 標準ゾーン（$10付近）：Kadenwood + Roth が最適解。", "EN": "✅ Base zone (~$10): Kadenwood + Roth is optimal."},
    "amort_warn":     {"JP": "⚠️ Amortisation Eventリスクゾーン。Yorkville署名は絶対禁止。", "EN": "⚠️ Amortisation Event risk zone. Signing Yorkville absolutely prohibited."},
    "d1": {"JP": "🔴 Yorkville署名禁止\n現状条件は会社存続リスク", "EN": "🔴 Do NOT sign Yorkville\nExistential risk under current terms"},
    "d2": {"JP": "🟢 Kadenwood最優先\n今週中にエンゲージメントレター署名", "EN": "🟢 Prioritize Kadenwood\nSign engagement letter this week"},
    "d3": {"JP": "🟢 Roth CEF並行開始\n上場後10営業日以内にS-1提出", "EN": "🟢 Initiate Roth CEF in parallel\nS-1 within 10 business days of listing"},
    "d4": {"JP": "🟡 Yorkville再交渉は上場後\nプリペイド削除・Roth除外が条件", "EN": "🟡 Renegotiate Yorkville post-listing\nRemove Pre-Paid, add Roth carve-out"},
    "d5": {"JP": "🔵 トークンレイズ並行検討\n株式希薄化ゼロの補完調達", "EN": "🔵 Pursue token raise in parallel\nZero equity dilution"},
    "footer": {"JP": "Instinct Brothers Holdings | 社外秘 | May 2026", "EN": "Instinct Brothers Holdings | Confidential | May 2026"},
}

def t(key): return T[key][lang]

SHARES = 15_000_000
KW_AMT = 5_000_000
ROTH_AMT = 10_000_000
YK_AMT = 3_000_000
DEADLINE = date(2026, 6, 2)

def dil(new_s): return (new_s / (SHARES + new_s)) * 100

# Header
col_h, col_l = st.columns([5,1])
with col_l:
    if st.button(t("lang_btn")):
        st.session_state.lang = EN if lang == JP else JP
        st.rerun()
with col_h:
    st.title(f"📊 {t('title')}")
st.caption(t("caption"))

days_left = (DEADLINE - date.today()).days
st.metric("⏰ Kadenwood Deadline", f"{days_left} {'日' if lang==JP else 'days'}", delta="URGENT", delta_color="inverse")
st.divider()

price = st.slider(t("slider"), min_value=1.0, max_value=25.0, value=10.0, step=0.5, format="$%.2f")

kw18_c = price * 0.82; kw18_s = int(KW_AMT/kw18_c); kw18_d = dil(kw18_s)
kw30_c = price * 0.70; kw30_s = int(KW_AMT/kw30_c); kw30_d = dil(kw30_s)
roth_p = price * 0.97; roth_s = int(ROTH_AMT/roth_p); roth_cap = int(SHARES*0.1999)*price
yk_raw = price * 0.93; yk_c = max(yk_raw, 1.0); yk_s = int(YK_AMT/yk_c); yk_d = dil(yk_s)

if price < 2: st.error(t("zone_danger"))
elif price <= 3: st.warning(t("zone_watch")); st.error(t("amort_warn"))
elif price <= 5: st.warning(t("zone_watch"))
elif price >= 15: st.success(t("zone_good"))
else: st.info(t("zone_normal"))

tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs([t("tab1"), t("tab2"), t("tab3"), t("tab4"), t("tab5"), t("tab6")])

# ── TAB 1: 希薄化グラフ ──
with tab1:
    st.subheader(t("dil_title"))
    st.caption(t("dil_note"))
    prices = [i*0.5 for i in range(2, 51)]
    kw18_line = [dil(int(KW_AMT/(p*0.82))) for p in prices]
    kw30_line = [dil(int(KW_AMT/(p*0.70))) for p in prices]
    yk_line   = [dil(int(YK_AMT/max(p*0.93,1.0))) for p in prices]
    fig1 = go.Figure()
    fig1.add_trace(go.Scatter(x=prices, y=kw18_line, name="Kadenwood 18%", line=dict(color="#1D9E75", width=2)))
    fig1.add_trace(go.Scatter(x=prices, y=kw30_line, name="Kadenwood 30%", line=dict(color="#0F6E56", width=2, dash="dash")))
    fig1.add_trace(go.Scatter(x=prices, y=yk_line,   name="Yorkville",     line=dict(color="#E24B4A", width=2)))
    fig1.add_vline(x=price, line_color="red", line_dash="dot", annotation_text=f"${price:.1f}", annotation_position="top right")
    fig1.add_hrect(y0=0, y1=5,  fillcolor="#1D9E75", opacity=0.05, line_width=0, annotation_text="Safe" if lang==EN else "安全", annotation_position="left")
    fig1.add_hrect(y0=5, y1=10, fillcolor="#FFA500", opacity=0.05, line_width=0, annotation_text="Caution" if lang==EN else "注意", annotation_position="left")
    fig1.add_hrect(y0=10,y1=30, fillcolor="#E24B4A", opacity=0.05, line_width=0, annotation_text="Danger" if lang==EN else "危険", annotation_position="left")
    fig1.update_layout(
        xaxis_title="Stock Price (USD)", yaxis_title="Dilution (%)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        plot_bgcolor="white", paper_bgcolor="white",
        height=320, margin=dict(l=10,r=10,t=40,b=30), font=dict(size=11)
    )
    st.plotly_chart(fig1, use_container_width=True)

    c1,c2,c3 = st.columns(3)
    c1.metric("Kadenwood 18%", f"{kw18_d:.1f}%", f"{kw18_s:,} shares")
    c2.metric("Kadenwood 30%", f"{kw30_d:.1f}%", f"{kw30_s:,} shares")
    c3.metric("Yorkville",     f"{yk_d:.1f}%",   f"{yk_s:,} shares", delta_color="inverse")

# ── TAB 2: コスト比較 ──
with tab2:
    st.subheader(t("cost_title"))
    categories = ["All-in Cost", "Issuer Control\n(1=Full)", "Dilution Risk\n(1=Low)", "Timing Control\n(1=Issuer)"]
    kw_vals  = [0.35, 0.9, 0.8, 0.9]
    roth_vals= [0.05, 1.0, 0.9, 1.0]
    yk_vals  = [0.07, 0.1, 0.2, 0.1]

    fig2 = go.Figure()
    fig2.add_trace(go.Bar(name="Kadenwood", x=categories, y=kw_vals,  marker_color="#1D9E75"))
    fig2.add_trace(go.Bar(name="Roth",      x=categories, y=roth_vals,marker_color="#2563EB"))
    fig2.add_trace(go.Bar(name="Yorkville", x=categories, y=yk_vals,  marker_color="#E24B4A"))
    fig2.update_layout(
        barmode="group", yaxis=dict(range=[0,1.1], tickformat=".0%"),
        plot_bgcolor="white", paper_bgcolor="white",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        height=300, margin=dict(l=10,r=10,t=40,b=10), font=dict(size=10)
    )
    st.plotly_chart(fig2, use_container_width=True)

    data_tbl = {
        "": ["Kadenwood", "Roth", "Yorkville"],
        "Size": ["$5M", "$50M", "$3M"],
        "Cost": ["28–42%", "~5%", "~7%*"],
        "Control": ["Issuer" if lang==EN else "発行者", "Issuer" if lang==EN else "発行者", "Investor" if lang==EN else "投資家"],
        "Verdict": ["✅ GO", "✅ GO", "❌ NO GO"],
    }
    st.dataframe(pd.DataFrame(data_tbl), use_container_width=True, hide_index=True)
    st.caption("*Yorkville: 実効コストはAmortisation Event発動時に430%超に跳ね上がる" if lang==JP else "*Yorkville: effective cost exceeds 430% if Amortisation Event triggers")

    st.subheader(t("capital_title"))
    cap_labels = ["Kadenwood", "Roth CEF\n($10M draw)", "Roth CEF\n(19.99% cap)", "Token Raise\n(target)"]
    cap_vals   = [5, 10, roth_cap/1e6, 50]
    cap_colors = ["#1D9E75","#2563EB","#1E40AF","#7C3AED"]
    fig3 = go.Figure(go.Bar(x=cap_labels, y=cap_vals, marker_color=cap_colors,
                            text=[f"${v:.1f}M" for v in cap_vals], textposition="outside"))
    fig3.update_layout(
        yaxis_title="USD Million", plot_bgcolor="white", paper_bgcolor="white",
        height=260, margin=dict(l=10,r=10,t=10,b=10), font=dict(size=11)
    )
    st.plotly_chart(fig3, use_container_width=True)

# ── TAB 3: シナリオ予測 ──
with tab3:
    st.subheader(t("scenario_title"))
    years = [2025, 2026, 2027, 2028, 2029, 2030]
    labels_y = ["Listing", "Y+1", "Y+2", "Y+3", "Y+4", "Y+5"]

    bear = [None, 50,  80,  120, 180, 250]
    base = [None, 200, 500, 800, 1200,2000]
    bull = [None, 500, 1000,2000,3000,4000]

    fig4 = go.Figure()
    fig4.add_trace(go.Scatter(x=labels_y[1:], y=bear[1:], name=t("bear"),
        line=dict(color="#E24B4A", width=2, dash="dash"),
        fill=None))
    fig4.add_trace(go.Scatter(x=labels_y[1:], y=base[1:], name=t("base"),
        line=dict(color="#1D9E75", width=3),
        fill="tonexty", fillcolor="rgba(29,158,117,0.08)"))
    fig4.add_trace(go.Scatter(x=labels_y[1:], y=bull[1:], name=t("bull"),
        line=dict(color="#2563EB", width=2, dash="dot"),
        fill="tonexty", fillcolor="rgba(37,99,235,0.06)"))
    fig4.add_hline(y=1000, line_dash="dot", line_color="gray", annotation_text="$1B Target", annotation_position="right")
    fig4.add_hline(y=4000, line_dash="dot", line_color="#7C3AED", annotation_text="$4B Target", annotation_position="right")
    fig4.update_layout(
        yaxis_title=t("mktcap"), xaxis_title=t("year"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        plot_bgcolor="white", paper_bgcolor="white",
        height=320, margin=dict(l=10,r=60,t=40,b=20), font=dict(size=11)
    )
    st.plotly_chart(fig4, use_container_width=True)

    tbl = {
        t("year"):  ["Listing","Y+1","Y+2","Y+3","Y+4","Y+5"],
        t("bear"):  ["$150M","$50M","$80M","$120M","$180M","$250M"],
        t("base"):  ["$150M","$200M","$500M","$800M","$1.2B","$2B"],
        t("bull"):  ["$150M","$500M","$1B","$2B","$3B","$4B"],
    }
    st.dataframe(pd.DataFrame(tbl), use_container_width=True, hide_index=True)

    st.markdown("---")
    if lang == JP:
        st.markdown("""
**シナリオ前提**
- 🔴 **弱気**：上場後株価低迷・Yorkville署名で資金繰り悪化・SPAC希薄化で株主離脱
- 🟢 **標準**：Kadenwood+Roth推奨スタック実行・Q3/Q4でRWA・BioTrace本番稼働
- 🔵 **強気**：トークンレイズ成功・地域銀行買収・F1/FQプロジェクト商業化・$4B達成
        """)
    else:
        st.markdown("""
**Scenario Assumptions**
- 🔴 **Bear**: Post-listing stock decline, Yorkville triggers cash crisis, SPAC dilution causes shareholder exit
- 🟢 **Base**: Kadenwood+Roth stack executed, RWA & BioTrace live in Q3/Q4
- 🔵 **Bull**: Token raise succeeds, regional bank acquisition, F1/FQ commercialization, $4B achieved
        """)

# ── TAB 4: リスク分析 ──
with tab4:
    st.subheader(t("risk_title"))

    # Yorkville Amortisation シミュ
    st.markdown(f"**{t('amort_title')}**")
    months = list(range(1, 13))
    rev_monthly = 2_240_000 / 12
    amort = 802_500
    cash_no_yk  = [rev_monthly * m for m in months]
    cash_with_yk= [max(0, rev_monthly * m - amort * m) for m in months]
    fig5 = go.Figure()
    fig5.add_trace(go.Scatter(x=months, y=[c/1e6 for c in cash_no_yk],
        name="Yorkvilleなし" if lang==JP else "Without Yorkville",
        line=dict(color="#1D9E75", width=2), fill="tozeroy", fillcolor="rgba(29,158,117,0.1)"))
    fig5.add_trace(go.Scatter(x=months, y=[c/1e6 for c in cash_with_yk],
        name="Yorkville発動時" if lang==JP else "Yorkville Triggered",
        line=dict(color="#E24B4A", width=2), fill="tozeroy", fillcolor="rgba(226,75,74,0.1)"))
    fig5.add_hline(y=0, line_color="black", line_width=1)
    fig5.update_layout(
        xaxis_title="Month", yaxis_title="Cumulative Cash ($M)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        plot_bgcolor="white", paper_bgcolor="white",
        height=280, margin=dict(l=10,r=10,t=40,b=20), font=dict(size=11)
    )
    st.plotly_chart(fig5, use_container_width=True)
    st.error("$802,500/月 × 12 = $9,630,000/年 vs 売上 $2,240,000/年 → **売上の430%**" if lang==JP
             else "$802,500/mo × 12 = $9,630,000/yr vs Revenue $2,240,000/yr → **430% of annual revenue**")

    st.markdown("---")
    # リスクマトリクス
    st.markdown("**Risk Matrix**")
    risks = {
        "JP": ["Yorkville\n署名リスク","SPAC\n希薄化","株価\n低迷","Kadenwood\n締切超過","競合\n参入","規制\n変更"],
        "EN": ["Yorkville\nSigning","SPAC\nDilution","Stock\nDecline","Kadenwood\nDeadline","Competition","Regulation"],
    }
    prob  = [0.9, 0.5, 0.4, 0.8, 0.3, 0.4]
    impact= [0.95,0.6, 0.7, 0.7, 0.5, 0.6]
    colors_r = ["#E24B4A","#F97316","#F97316","#E24B4A","#FCD34D","#FCD34D"]
    fig6 = go.Figure()
    fig6.add_trace(go.Scatter(
        x=prob, y=impact,
        mode="markers+text",
        text=risks[lang],
        textposition="top center",
        marker=dict(size=18, color=colors_r, opacity=0.85),
    ))
    fig6.add_vline(x=0.5, line_dash="dot", line_color="gray")
    fig6.add_hline(y=0.5, line_dash="dot", line_color="gray")
    fig6.update_layout(
        xaxis=dict(title="Probability", range=[0,1.1], tickformat=".0%"),
        yaxis=dict(title="Impact", range=[0,1.1], tickformat=".0%"),
        plot_bgcolor="#FAFAFA", paper_bgcolor="white",
        height=320, margin=dict(l=10,r=10,t=10,b=30), font=dict(size=10),
        showlegend=False
    )
    st.plotly_chart(fig6, use_container_width=True)

    # VRT禁止の損失
    st.markdown("---")
    st.markdown("**Yorkville VRT禁止 — 機会損失**" if lang==JP else "**Yorkville VRT Prohibition — Opportunity Cost**")
    fig7 = go.Figure(go.Waterfall(
        orientation="v",
        measure=["absolute","relative","relative","total"],
        x=["Yorkville Pre-Paid", "Roth CEF Lost", "Token Raise Lost", "Net Position"],
        y=[3, -50, -50, 0],
        text=["$3M gained", "$50M lost", "$50M lost", "Net: -$97M"],
        textposition="outside",
        connector={"line":{"color":"gray"}},
        increasing={"marker":{"color":"#1D9E75"}},
        decreasing={"marker":{"color":"#E24B4A"}},
        totals={"marker":{"color":"#1E40AF"}},
    ))
    fig7.update_layout(
        yaxis_title="USD Million", plot_bgcolor="white", paper_bgcolor="white",
        height=280, margin=dict(l=10,r=10,t=10,b=10), font=dict(size=11)
    )
    st.plotly_chart(fig7, use_container_width=True)

# ── TAB 5: 意思決定 ──
with tab5:
    st.subheader(t("decision_title"))
    for key in ["d1","d2","d3","d4","d5"]:
        text = t(key)
        if text.startswith("🔴"):
            st.error(text.replace("\n", "  \n"))
        elif text.startswith("🟢"):
            st.success(text.replace("\n", "  \n"))
        elif text.startswith("🟡"):
            st.warning(text.replace("\n", "  \n"))
        else:
            st.info(text.replace("\n", "  \n"))

    st.markdown("---")
    st.markdown("**Timeline**")
    tl = {
        "JP": {
            "🚨 今すぐ（今週）": ["Kadenwoodエンゲージメントレター署名（期限超過・即時対応）","Yorkville再交渉通知","Roth CEF書類準備開始"],
            "📅 5月中": ["Kadenwood最終条件確定","Roth CEF署名","トークンロードマップ策定"],
            "📅 6月": ["Kadenwood $5Mクローズ（6/2目標）","NASDAQ上場承認"],
            "📅 上場後": ["Roth CEF開始・S-1提出（10営業日以内）","Yorkville再交渉（条件付き）","トークンレイズ開始"],
        },
        "EN": {
            "🚨 Now (This Week)": ["Sign Kadenwood engagement letter (MISSED — act immediately)","Notify Yorkville of renegotiation conditions","Begin Roth CEF documentation"],
            "📅 May": ["Finalize Kadenwood terms","Sign Roth CEF","Develop token raise roadmap"],
            "📅 June": ["Kadenwood $5M close (target: June 2)","NASDAQ listing approval"],
            "📅 Post-Listing": ["Roth CEF commences, S-1 within 10 business days","Yorkville renegotiation (conditional)","Token raise launch"],
        }
    }
    for phase, actions in tl[lang].items():
        with st.expander(phase, expanded=("今すぐ" in phase or "Now" in phase)):
            for a in actions:
                st.markdown(f"- {a}")

# ── TAB 6: CHARDAN分析 ──
with tab6:
    CHARDAN_SHARES   = 1_615_000
    CHARDAN_COST     = 3.25
    CHARDAN_TOTAL_COST = CHARDAN_SHARES * CHARDAN_COST  # $5,248,750

    st.subheader("🏦 CHARDAN Capital — 売却シミュレーション" if lang=="JP" else "🏦 CHARDAN Capital — Sell Scenario Simulator")
    st.caption(f"保有株数: {CHARDAN_SHARES:,}株 ／ 取得単価: $3.25 ／ 取得総額: ${CHARDAN_TOTAL_COST:,.0f}" if lang=="JP"
               else f"Shares held: {CHARDAN_SHARES:,} ／ Avg cost: $3.25 ／ Total cost basis: ${CHARDAN_TOTAL_COST:,.0f}")

    col_s1, col_s2 = st.columns(2)
    with col_s1:
        sell_shares = st.slider(
            "売却株数" if lang=="JP" else "Shares to Sell",
            min_value=0, max_value=CHARDAN_SHARES, value=0, step=10_000,
            format="%d shares"
        )
    with col_s2:
        sell_price = st.slider(
            "売却単価 (USD)" if lang=="JP" else "Sell Price (USD)",
            min_value=0.1, max_value=6.0, value=3.25, step=0.05,
            format="$%.2f"
        )

    # 計算
    remain_shares  = CHARDAN_SHARES - sell_shares
    sell_proceeds  = sell_shares * sell_price
    pnl            = sell_proceeds - (sell_shares * CHARDAN_COST)
    pnl_pct        = (pnl / (sell_shares * CHARDAN_COST) * 100) if sell_shares > 0 else 0
    remain_value   = remain_shares * sell_price
    total_shares_after = SHARES + sell_shares  # 市場に出る株数が増える
    # 売却圧力による推定株価影響（簡易モデル：売却株数/流通株数 × 感応度）
    float_shares   = SHARES  # 現在の流通株数
    sell_pressure_pct = (sell_shares / float_shares) * 100 if float_shares > 0 else 0
    # 株価への影響推定（売却比率1%あたり約0.5%の下落と仮定）
    price_impact_pct  = sell_pressure_pct * 0.5
    estimated_price   = max(0.1, price - (price * price_impact_pct / 100))

    # KPIカード
    st.markdown("---")
    k1,k2,k3,k4 = st.columns(4)
    k1.metric("売却株数" if lang=="JP" else "Shares Sold",
              f"{sell_shares:,}", f"{sell_shares/CHARDAN_SHARES*100:.1f}%")
    k2.metric("売却収益" if lang=="JP" else "Proceeds",
              f"${sell_proceeds:,.0f}",
              f"{'損益: ' if lang=='JP' else 'P&L: '}${pnl:+,.0f}")
    k3.metric("CHARDAN損益率" if lang=="JP" else "CHARDAN P&L %",
              f"{pnl_pct:+.1f}%",
              delta_color="normal" if pnl >= 0 else "inverse")
    k4.metric("推定株価影響" if lang=="JP" else "Est. Price Impact",
              f"${estimated_price:.2f}",
              f"{-price_impact_pct:.1f}%", delta_color="inverse")

    st.markdown("---")

    # ── グラフ①：売却単価別 損益ブレークイーブン ──
    st.markdown("**① 売却単価別 CHARDAN損益**" if lang=="JP" else "**① CHARDAN P&L by Sell Price**")
    sp_range = [i*0.1 for i in range(1, 61)]
    pnl_range = [(p - CHARDAN_COST) * sell_shares if sell_shares > 0 else 0 for p in sp_range]
    fig_c1 = go.Figure()
    fig_c1.add_trace(go.Scatter(
        x=sp_range, y=pnl_range,
        mode="lines", fill="tozeroy",
        line=dict(color="#2563EB", width=2),
        fillcolor="rgba(37,99,235,0.08)",
        name="P&L"
    ))
    fig_c1.add_vline(x=CHARDAN_COST, line_dash="dash", line_color="#E24B4A",
                     annotation_text="Cost $3.25", annotation_position="top right")
    fig_c1.add_vline(x=sell_price, line_dash="dot", line_color="#1D9E75",
                     annotation_text=f"Current ${sell_price:.2f}", annotation_position="top left")
    fig_c1.add_hline(y=0, line_color="black", line_width=1)
    fig_c1.update_layout(
        xaxis_title="Sell Price (USD)", yaxis_title="P&L (USD)",
        plot_bgcolor="white", paper_bgcolor="white",
        height=260, margin=dict(l=10,r=10,t=10,b=30), font=dict(size=11),
        showlegend=False
    )
    st.plotly_chart(fig_c1, use_container_width=True)

    # ── グラフ②：売却株数別 株価影響 ──
    st.markdown("**② 売却株数別 推定株価影響**" if lang=="JP" else "**② Est. Stock Price Impact by Shares Sold**")
    shares_range = list(range(0, CHARDAN_SHARES+1, 50_000))
    price_impact_range = [max(0.1, price - price * (s/float_shares)*0.5) for s in shares_range]
    fig_c2 = go.Figure()
    fig_c2.add_trace(go.Scatter(
        x=[s/1000 for s in shares_range],
        y=price_impact_range,
        mode="lines", fill="tozeroy",
        line=dict(color="#E24B4A", width=2),
        fillcolor="rgba(226,75,74,0.08)",
    ))
    fig_c2.add_vline(x=sell_shares/1000, line_dash="dot", line_color="#2563EB",
                     annotation_text=f"{sell_shares:,} shares", annotation_position="top right")
    fig_c2.add_hline(y=CHARDAN_COST, line_dash="dash", line_color="#1D9E75",
                     annotation_text="CHARDAN cost $3.25", annotation_position="right")
    fig_c2.update_layout(
        xaxis_title="Shares Sold (thousands)",
        yaxis_title="Estimated Stock Price ($)",
        plot_bgcolor="white", paper_bgcolor="white",
        height=260, margin=dict(l=10,r=10,t=10,b=30), font=dict(size=11),
        showlegend=False
    )
    st.plotly_chart(fig_c2, use_container_width=True)

    # ── グラフ③：株式構成ドーナツ ──
    st.markdown("**③ 売却後の株式構成**" if lang=="JP" else "**③ Post-Sale Share Structure**")
    labels_d = ["CHARDAN保有残" if lang=="JP" else "CHARDAN Remaining",
                "CHARDAN売却分" if lang=="JP" else "CHARDAN Sold",
                "その他株主" if lang=="JP" else "Other Shareholders"]
    values_d = [remain_shares, sell_shares, SHARES - CHARDAN_SHARES]
    colors_d = ["#2563EB","#E24B4A","#1D9E75"]
    fig_c3 = go.Figure(go.Pie(
        labels=labels_d, values=values_d, hole=0.55,
        marker_colors=colors_d,
        textinfo="label+percent",
        textfont_size=11,
    ))
    fig_c3.update_layout(
        height=280, margin=dict(l=10,r=10,t=10,b=10),
        showlegend=False,
        annotations=[dict(text=f"{sell_shares/CHARDAN_SHARES*100:.0f}%<br>Sold", x=0.5, y=0.5, font_size=14, showarrow=False)]
    )
    st.plotly_chart(fig_c3, use_container_width=True)

    # ── 総合バランス表 ──
    st.markdown("---")
    st.markdown("**④ 総合インパクト表**" if lang=="JP" else "**④ Full Impact Summary**")

    impact_data = {
        "項目" if lang=="JP" else "Item": [
            "CHARDAN取得単価" if lang=="JP" else "CHARDAN Cost Basis",
            "現在の売却単価" if lang=="JP" else "Current Sell Price",
            "売却株数" if lang=="JP" else "Shares Sold",
            "売却収益" if lang=="JP" else "Sell Proceeds",
            "CHARDAN損益" if lang=="JP" else "CHARDAN P&L",
            "CHARDAN損益率" if lang=="JP" else "CHARDAN P&L %",
            "残保有株数" if lang=="JP" else "Remaining Shares",
            "残保有株価値" if lang=="JP" else "Remaining Value",
            "売却圧力（対流通株）" if lang=="JP" else "Sell Pressure vs Float",
            "推定株価影響" if lang=="JP" else "Est. Price Impact",
            "推定新株価" if lang=="JP" else "Est. New Stock Price",
            "Kadenwood希薄化率（新株価）" if lang=="JP" else "Kadenwood Dilution (new price)",
        ],
        "数値" if lang=="JP" else "Value": [
            f"$3.25",
            f"${sell_price:.2f}",
            f"{sell_shares:,} 株",
            f"${sell_proceeds:,.0f}",
            f"${pnl:+,.0f}",
            f"{pnl_pct:+.1f}%",
            f"{remain_shares:,} 株",
            f"${remain_value:,.0f}",
            f"{sell_pressure_pct:.2f}%",
            f"-{price_impact_pct:.2f}%",
            f"${estimated_price:.2f}",
            f"{dil(int(KW_AMT/(estimated_price*0.82))):.1f}%",
        ],
        "判定" if lang=="JP" else "Status": [
            "ℹ️","ℹ️","ℹ️",
            "✅" if sell_proceeds > 0 else "ー",
            "✅" if pnl >= 0 else "🔴",
            "✅" if pnl_pct >= 0 else "🔴",
            "ℹ️","ℹ️",
            "✅" if sell_pressure_pct < 5 else ("⚠️" if sell_pressure_pct < 10 else "🔴"),
            "✅" if price_impact_pct < 2 else ("⚠️" if price_impact_pct < 5 else "🔴"),
            "✅" if estimated_price >= 8 else ("⚠️" if estimated_price >= 5 else "🔴"),
            "✅" if dil(int(KW_AMT/(max(estimated_price,0.5)*0.82))) < 5 else "⚠️",
        ]
    }
    import pandas as pd
    st.dataframe(pd.DataFrame(impact_data), use_container_width=True, hide_index=True)

    # 警告
    if sell_pressure_pct >= 10:
        st.error("🚨 売却圧力が10%超 — 市場への深刻な下押し圧力。段階的売却を強く推奨。" if lang=="JP"
                 else "🚨 Sell pressure exceeds 10% — serious downward pressure on market. Staged selling strongly recommended.")
    elif sell_pressure_pct >= 5:
        st.warning("⚠️ 売却圧力が5%超 — 株価への影響に注意。" if lang=="JP"
                   else "⚠️ Sell pressure exceeds 5% — monitor price impact.")
    else:
        st.success("✅ 売却圧力は軽微 — 市場への影響は限定的。" if lang=="JP"
                   else "✅ Sell pressure is minor — limited market impact.")

    if pnl < 0:
        st.warning(f"⚠️ CHARDAN はこの単価では損失（${pnl:,.0f}）。売却インセンティブが低く、保有継続の可能性あり。" if lang=="JP"
                   else f"⚠️ CHARDAN takes a loss (${pnl:,.0f}) at this price. Low incentive to sell — may hold.")
    else:
        st.info(f"ℹ️ CHARDANの利益: ${pnl:,.0f}（+{pnl_pct:.1f}%）。売却インセンティブあり。" if lang=="JP"
                else f"ℹ️ CHARDAN profit: ${pnl:,.0f} (+{pnl_pct:.1f}%). Incentive to sell exists.")

st.divider()
st.caption(t("footer"))
