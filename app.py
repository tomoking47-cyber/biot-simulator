import streamlit as st
import plotly.graph_objects as go
import pandas as pd
from datetime import date
import yfinance as yf

st.set_page_config(page_title="BIOT Capital Simulator", page_icon="📊", layout="centered")
st.markdown("""
<style>
html,body,[class*="css"]{font-size:clamp(12px,2.5vw,15px)!important}
[data-testid="stMetricLabel"]{font-size:clamp(10px,1.8vw,12px)!important;white-space:normal!important;word-break:break-word!important}
[data-testid="stMetricValue"]{font-size:clamp(14px,3vw,22px)!important}
[data-testid="column"]{padding:0 3px!important}
p,div,span,label{word-break:break-word!important;overflow-wrap:break-word!important}
h1{font-size:clamp(16px,3.5vw,24px)!important}
h2{font-size:clamp(14px,2.8vw,20px)!important}
[data-testid="stButton"] button{font-size:clamp(11px,1.8vw,13px)!important}
[data-testid="stAlert"]{font-size:clamp(11px,1.8vw,13px)!important;padding:6px 10px!important}
[data-testid="stTabs"] button{font-size:clamp(10px,1.6vw,12px)!important;padding:3px 5px!important}
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

lang = st.session_state.lang
def jp(j, e): return j if lang == "JP" else e

col_h, col_l = st.columns([5,1])
with col_l:
    if st.button("🇺🇸 EN" if lang=="JP" else "🇯🇵 JP"):
        st.session_state.lang = "EN" if lang=="JP" else "JP"
        st.rerun()
with col_h:
    st.title(f"📊 {jp('BIOT 統合資本管理シミュレーター','BIOT Integrated Capital Simulator')}")
st.caption(jp("Instinct Brothers Holdings | 発行済株数 41,254,857株 | 社外秘",
              "Instinct Brothers Holdings | 41,254,857 shares | CONFIDENTIAL"))
st.divider()

# ── 定数（最終CAP TABLE・ROTH一本）──
TOTAL_SHARES = 41_254_857
FLOAT_SHARES = 18_882_313
ROTH_MAX     = 150_000_000   # ROTH CEF 最大枠
ROTH_MIN     = 10_000_000    # ROTH CEF 最低
ROTH_DISCOUNT = 0.03         # 発行価格 = VWAPの97%
EXCHANGE_CAP_PCT = 0.1999    # 株主承認なしの発行上限
PRICE_FLOOR  = 1.00          # 前日終値$1未満は引出不可
COMMIT_FEE_PCT = 0.02        # コミットメントフィー2%
SENSITIVITY = 1.5            # 1%売圧 → 1.5%株価下落

# 最終CAP TABLE
SHAREHOLDERS = [
    ("Nagano Tomoki",            "Nagano Tomoki",          10_425_115, 12,   None,  False),
    ("Nagano (Chardan充当)",     "Nagano (for Chardan)",    1_615_385,  0,   None,  False),
    ("Public Stockholders",      "Public Stockholders",        40_622,  0,  10.00, True),
    ("Officer/Director/近親者",  "Officer/Director/Family",    73_100, 12,   None, False),
    ("Target Stockholders",      "Target Stockholders",     9_936_400,  0,   None, True),
    ("CHARDAN",                  "CHARDAN",                 1_615_385,  0,   3.25, True),
    ("Everise Concepts",         "Everise Concepts",          450_000,  0,   None, True),
    ("Initial Stockholders",     "Initial Stockholders",      738_369, 12,  10.00, False),
    ("Sponsor (Relativity)",     "Sponsor (Relativity)",    5_515_481,  0,   None, True),
    ("Sponsor's service prov.",  "Sponsor's service prov.",   845_000,  0,   None, True),
    ("New Share Issuance (CEF既存)","New Issuance (CEF existing)",10_000_000, 0, None, True),
]
sellable = [(r[0],r[1],r[2],r[4]) for r in SHAREHOLDERS if r[5]]
locked   = [(r[0],r[1],r[2],r[3]) for r in SHAREHOLDERS if not r[5]]
NAGANO_SHARES = 10_425_115 + 1_615_385
BLOCK_LINE = 33.34

def dil(new_s, base=TOTAL_SHARES):
    return new_s / (base + new_s) * 100

def calc_price(listing_px, sell_pct_of_float):
    drop_pct = sell_pct_of_float * SENSITIVITY
    return max(0.10, listing_px * (1 - drop_pct / 100))

# ── Dify APIキー設定（Streamlit Secrets経由）──
import os
DIFY_BASE = "https://api.dify.ai/v1"
DIFY_KEYS = {
    "統括参謀": os.environ.get("DIFY_KEY_GENERAL", ""),
    "CFO参謀":  os.environ.get("DIFY_KEY_CFO",     ""),
    "情報参謀": os.environ.get("DIFY_KEY_INFO",    ""),
}
try:
    if st.secrets.get("DIFY_KEY_GENERAL"): DIFY_KEYS["統括参謀"] = st.secrets["DIFY_KEY_GENERAL"]
    if st.secrets.get("DIFY_KEY_CFO"):     DIFY_KEYS["CFO参謀"]  = st.secrets["DIFY_KEY_CFO"]
    if st.secrets.get("DIFY_KEY_INFO"):    DIFY_KEYS["情報参謀"] = st.secrets["DIFY_KEY_INFO"]
except: pass

import requests, json

def call_dify(api_key: str, user_message: str, conversation_id: str = "") -> dict:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"inputs": {}, "query": user_message, "response_mode": "blocking", "user": "biot-boss"}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    try:
        resp = requests.post(f"{DIFY_BASE}/chat-messages", headers=headers,
                             data=json.dumps(payload), timeout=60)
        if resp.status_code == 200:
            data = resp.json()
            return {"ok": True, "answer": data.get("answer",""), "conv_id": data.get("conversation_id","")}
        else:
            return {"ok": False, "answer": f"Error {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"ok": False, "answer": f"接続エラー: {str(e)}"}

for role in ["統括参謀","CFO参謀","情報参謀"]:
    if f"chat_{role}" not in st.session_state:
        st.session_state[f"chat_{role}"] = []
    if f"conv_id_{role}" not in st.session_state:
        st.session_state[f"conv_id_{role}"] = ""

# ── タブ ──
tab1,tab2,tab3,tab4,tab5,tab6,tab7 = st.tabs([
    jp("🏦 上場当日 株価予測","🏦 Day-1 Price Forecast"),
    jp("💰 ROTH CEF 調達","💰 ROTH CEF Financing"),
    jp("📊 希薄化分析","📊 Dilution"),
    jp("📈 シナリオ予測","📈 Scenarios"),
    jp("⚠️ リスク分析","⚠️ Risk"),
    jp("🎯 意思決定","🎯 Decision"),
    jp("🎲 Sponsor売り抜け","🎲 Sponsor Dump"),
])

# ════════════════════════════════════════════════════════
# TAB 1: 上場当日 株価予測
# ════════════════════════════════════════════════════════
with tab1:
    st.subheader(jp("🏦 上場当日 株価予測シミュレーター","🏦 Day-1 Stock Price Forecast"))
    st.caption(jp(
        "各株主が上場当日に何株売ったら、BIOTの株価は$いくらになるか。スライダーで操作してリアルタイムで確認できます。",
        "How much will BIOT stock drop if each shareholder sells on listing day? Move sliders to see real-time price forecast."
    ))

    listing_price = st.slider(
        jp("上場基準価格 (USD)","Listing Base Price (USD)"),
        0.1, 20.0, 10.0, 0.1, format="$%.2f"
    )

    st.markdown(f"### {jp('📌 各株主の売却株数を設定','📌 Set Each Shareholder Sell Amount')}")

    RISK_ICON = {
        "CHARDAN":"🔴", "Sponsor (Relativity)":"🔴", "Target Stockholders":"🟠",
        "Initial Stockholders":"🟡","Public Stockholders":"🟡",
    }

    sell_data = []
    for n_jp, n_en, max_sh, cost in sellable:
        name = jp(n_jp, n_en)
        icon = RISK_ICON.get(n_jp,"🟡")
        cost_str = f"${cost:.2f}" if cost else "N/A"
        with st.expander(f"{icon} {name}　保有: {max_sh:,}株　取得単価: {cost_str}" if lang=="JP"
                         else f"{icon} {name}　Held: {max_sh:,} shares　Cost: {cost_str}",
                         expanded=(n_jp in ["CHARDAN","Sponsor (Relativity)"])):
            sold = st.slider(
                jp("売却株数","Shares to Sell"),
                0, max_sh, 0, max(1000, max_sh//100), key=f"s_{n_jp}", format="%d"
            )
            sell_pct_own = sold/max_sh*100 if max_sh>0 else 0
            sell_pct_flt = sold/FLOAT_SHARES*100
            est_px_this  = calc_price(listing_price, sell_pct_flt)
            drop_this    = listing_price - est_px_this
            proceeds     = sold * listing_price
            pnl          = (listing_price - cost)*sold if cost and sold>0 else None

            c1,c2,c3,c4 = st.columns(4)
            c1.metric(jp("売却株数","Sold"), f"{sold:,}", f"{sell_pct_own:.1f}%")
            c2.metric(jp("この株主単独の株価影響","Price if only this seller"),
                      f"${est_px_this:.2f}", f"-${drop_this:.2f}", delta_color="inverse")
            c3.metric(jp("売却収益","Proceeds"), f"${proceeds:,.0f}")
            if pnl is not None:
                c4.metric(jp("CHARDAN損益","P&L"), f"${pnl:+,.0f}",
                    f"{((listing_price-cost)/cost*100):+.1f}%" if cost else "",
                    delta_color="normal" if pnl>=0 else "inverse")
            else:
                c4.metric(jp("売却圧力（対流通株）","Sell Pressure vs Float"), f"{sell_pct_flt:.2f}%")

            sell_data.append(dict(
                name=name, n_jp=n_jp, max_shares=max_sh,
                sold=sold, cost=cost, proceeds=proceeds, pnl=pnl,
                sell_pct_float=sell_pct_flt
            ))

    total_sold       = sum(d["sold"] for d in sell_data)
    total_proceeds   = sum(d["proceeds"] for d in sell_data)
    sell_pct_float   = total_sold / FLOAT_SHARES * 100
    sell_pct_total   = total_sold / TOTAL_SHARES * 100
    est_price        = calc_price(listing_price, sell_pct_float)
    price_drop_abs   = listing_price - est_price
    price_drop_pct   = price_drop_abs / listing_price * 100 if listing_price else 0

    st.session_state["listing_price_val"] = listing_price
    st.session_state["sell_pct_float_val"] = sell_pct_float
    st.session_state["est_price_val"] = est_price

    st.markdown("---")
    st.markdown(f"## {jp('📉 上場当日の推定株価','📉 Estimated Stock Price on Listing Day')}")

    col_big1, col_big2, col_big3 = st.columns(3)
    col_big1.metric(jp("上場基準価格","Listing Price"), f"${listing_price:.2f}")
    col_big2.metric(jp("🎯 推定終値（売却後）","🎯 Est. Closing Price"),
        f"${est_price:.2f}", f"-${price_drop_abs:.2f}  (-{price_drop_pct:.1f}%)", delta_color="inverse")
    col_big3.metric(jp("総売却圧力","Total Sell Pressure"), f"{sell_pct_float:.1f}%",
        jp(f"流通株の{sell_pct_float:.1f}%が売却",f"{sell_pct_float:.1f}% of float sold"))

    if est_price >= listing_price * 0.9:
        st.success(jp(f"✅ 株価は安定。推定終値 ${est_price:.2f}（下落率{price_drop_pct:.1f}%）— 軽微な影響。",
                      f"✅ Price stable. Est. close ${est_price:.2f} (drop {price_drop_pct:.1f}%) — minor impact."))
    elif est_price >= listing_price * 0.7:
        st.warning(jp(f"⚠️ 株価が下落。推定終値 ${est_price:.2f}（下落率{price_drop_pct:.1f}%）— 対策が必要。",
                      f"⚠️ Price declining. Est. close ${est_price:.2f} (drop {price_drop_pct:.1f}%) — action needed."))
    elif est_price >= listing_price * 0.5:
        st.error(jp(f"🚨 株価が大幅下落。推定終値 ${est_price:.2f}（下落率{price_drop_pct:.1f}%）— 緊急対策が必要。",
                    f"🚨 Major price drop. Est. close ${est_price:.2f} (drop {price_drop_pct:.1f}%) — emergency action needed."))
    else:
        st.error(jp(f"💀 株価崩壊。推定終値 ${est_price:.2f}（下落率{price_drop_pct:.1f}%）— 上場当日にBIOTが死ぬ。",
                    f"💀 Price collapse. Est. close ${est_price:.2f} (drop {price_drop_pct:.1f}%) — BIOT dies on listing day."))

    if est_price < 3.25:
        st.error(jp(f"⚠️ 推定株価 ${est_price:.2f} < CHARDAN取得単価 $3.25 → CHARDANは損失。売却インセンティブが下がる可能性。",
                    f"⚠️ Est. price ${est_price:.2f} < CHARDAN cost $3.25 → CHARDAN takes a loss. May reduce sell incentive."))
    if est_price < PRICE_FLOOR:
        st.error(jp(f"🔴 推定株価 ${est_price:.2f} < $1.00 → ROTH CEFが引出不可になる水準（タームシートの$1フロア）。",
                    f"🔴 Est. price ${est_price:.2f} < $1.00 → ROTH CEF cannot be drawn (term sheet $1 floor)."))

    st.markdown("---")

    # グラフ①
    st.markdown(f"### {jp('① 株主別売却株数と株価への影響','① Shares Sold & Price Impact per Shareholder')}")
    bar_names  = [d["name"] for d in sell_data]
    bar_sold   = [d["sold"] for d in sell_data]
    bar_impact = [listing_price - calc_price(listing_price, d["sell_pct_float"]) for d in sell_data]
    fig1 = go.Figure()
    fig1.add_trace(go.Bar(name=jp("売却株数","Shares Sold"), x=bar_names, y=bar_sold,
        marker_color=["#E24B4A" if s>0 else "#D1D5DB" for s in bar_sold], yaxis="y1", offsetgroup=1))
    fig1.add_trace(go.Scatter(name=jp("株価下落幅 ($)","Price Drop ($)"), x=bar_names, y=bar_impact,
        mode="markers+lines", marker=dict(size=10, color="#7C3AED"),
        line=dict(color="#7C3AED", width=2, dash="dot"), yaxis="y2"))
    fig1.update_layout(yaxis=dict(title=jp("売却株数","Shares Sold"), showgrid=False),
        yaxis2=dict(title=jp("株価下落幅 ($)","Price Drop ($)"), overlaying="y", side="right", showgrid=False),
        legend=dict(orientation="h", y=1.08, x=0), height=300, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=60,t=50,b=60), font=dict(size=10), barmode="group")
    st.plotly_chart(fig1, use_container_width=True)

    # グラフ②
    st.markdown(f"### {jp('② 売却圧力 → 推定株価 リアルタイムゲージ','② Sell Pressure → Est. Stock Price Gauge')}")
    fig2 = go.Figure()
    px_range = [i*0.5 for i in range(0,61)]
    price_curve = [calc_price(listing_price, p) for p in px_range]
    fig2.add_trace(go.Scatter(x=px_range, y=price_curve, mode="lines",
        fill="tozeroy", fillcolor="rgba(226,75,74,0.07)", line=dict(color="#E24B4A", width=3),
        name=jp("推定株価","Est. Price")))
    fig2.add_trace(go.Scatter(x=[sell_pct_float], y=[est_price], mode="markers+text",
        text=[f"  ${est_price:.2f}"], textfont=dict(size=16, color="#1E40AF"), textposition="middle right",
        marker=dict(size=18, color="#1E40AF", symbol="circle", line=dict(color="white", width=2)),
        name=jp("現在の売却圧力","Current Sell Pressure")))
    fig2.add_hline(y=listing_price, line_dash="dash", line_color="#1D9E75",
        annotation_text=jp(f"上場価格 ${listing_price:.2f}",f"Listing ${listing_price:.2f}"), annotation_position="right")
    fig2.add_hline(y=3.25, line_dash="dot", line_color="#F97316",
        annotation_text="CHARDAN cost $3.25", annotation_position="right")
    fig2.add_hline(y=PRICE_FLOOR, line_dash="dot", line_color="#E24B4A",
        annotation_text=jp("$1 ROTHフロア","$1 ROTH floor"), annotation_position="right")
    fig2.add_hrect(y0=listing_price*0.9, y1=listing_price*1.1, fillcolor="#1D9E75", opacity=0.07, line_width=0,
        annotation_text=jp("安全ゾーン","Safe"), annotation_position="left")
    fig2.add_hrect(y0=listing_price*0.7, y1=listing_price*0.9, fillcolor="#FCD34D", opacity=0.07, line_width=0,
        annotation_text=jp("注意","Caution"), annotation_position="left")
    fig2.add_hrect(y0=0, y1=listing_price*0.7, fillcolor="#E24B4A", opacity=0.07, line_width=0,
        annotation_text=jp("危険","Danger"), annotation_position="left")
    fig2.update_layout(xaxis=dict(title=jp("売却圧力（流通株に対する売却割合%）","Sell Pressure (% of Float)"), range=[0,62]),
        yaxis=dict(title=jp("推定株価 ($)","Est. Stock Price ($)"), range=[0, listing_price*1.15]),
        height=380, plot_bgcolor="white", paper_bgcolor="white",
        legend=dict(orientation="h", y=1.05, x=0), margin=dict(l=5,r=80,t=50,b=40), font=dict(size=11))
    st.plotly_chart(fig2, use_container_width=True)

    # グラフ③
    st.markdown(f"### {jp('③ シナリオ別 上場当日 推定株価','③ Day-1 Estimated Price by Scenario')}")
    scenarios_jp = ["全員売らない\n（理想）","CHARDANのみ\n売却","CHARDAN+\nTarget売却","CHARDAN+\nSponsor売却","流通株の\n50%売却","流通株の\n全部売却"]
    scenarios_en = ["Nobody Sells\n(Ideal)","CHARDAN Only\nSells","CHARDAN+\nTarget Sell","CHARDAN+\nSponsor Sell","50% of\nFloat Sells","All Float\nSells"]
    scenario_names = scenarios_jp if lang=="JP" else scenarios_en
    chardan_pct    = 1_615_385 / FLOAT_SHARES * 100
    target_pct     = (1_615_385 + 9_936_400) / FLOAT_SHARES * 100
    sponsor_pct    = (1_615_385 + 5_515_481) / FLOAT_SHARES * 100
    scenario_pressures = [0, chardan_pct, target_pct, sponsor_pct, 50.0, 100.0]
    scenario_prices    = [calc_price(listing_price, p) for p in scenario_pressures]
    scenario_drops     = [listing_price - p for p in scenario_prices]
    bar_colors_s = ["#1D9E75" if p>=listing_price*0.9 else "#FCD34D" if p>=listing_price*0.7
                    else "#F97316" if p>=listing_price*0.5 else "#E24B4A" for p in scenario_prices]
    fig3 = go.Figure()
    fig3.add_trace(go.Bar(x=scenario_names, y=scenario_prices, marker_color=bar_colors_s,
        text=[f"${p:.2f}" for p in scenario_prices], textposition="outside", textfont=dict(size=13, color="#1E1E1E")))
    fig3.add_hline(y=est_price, line_dash="dot", line_color="#1E40AF", line_width=2,
        annotation_text=jp(f"現在設定: ${est_price:.2f}",f"Current sim: ${est_price:.2f}"), annotation_position="right")
    fig3.add_hline(y=listing_price, line_dash="dash", line_color="#6B7280",
        annotation_text=jp(f"上場価格 ${listing_price:.2f}",f"Listing ${listing_price:.2f}"), annotation_position="right")
    fig3.update_layout(yaxis=dict(title=jp("推定株価 ($)","Est. Stock Price ($)"), range=[0, listing_price*1.2]),
        height=320, plot_bgcolor="white", paper_bgcolor="white", margin=dict(l=5,r=80,t=20,b=10),
        font=dict(size=11), showlegend=False)
    st.plotly_chart(fig3, use_container_width=True)

    tbl_s = pd.DataFrame({
        jp("シナリオ","Scenario"): scenario_names,
        jp("売却圧力","Sell Pressure"): [f"{p:.1f}%" for p in scenario_pressures],
        jp("推定株価","Est. Price"): [f"${p:.2f}" for p in scenario_prices],
        jp("下落幅","Drop"): [f"-${d:.2f}" for d in scenario_drops],
        jp("下落率","Drop%"): [f"{d/listing_price*100:.1f}%" for d in scenario_drops],
        jp("判定","Status"): ["✅ 安全" if p>=listing_price*0.9 else "⚠️ 注意" if p>=listing_price*0.7
            else "🔴 危険" if p>=listing_price*0.5 else "💀 崩壊" for p in scenario_prices]
    })
    st.dataframe(tbl_s, use_container_width=True, hide_index=True)

    st.markdown("---")
    st.markdown(f"### {jp('④ 全株主 売却インパクト一覧','④ Full Sell Impact Table')}")
    rows=[]
    for d in sell_data:
        individual_est = calc_price(listing_price, d["sell_pct_float"])
        rows.append({
            jp("株主","Shareholder"): d["name"],
            jp("保有株数","Held"): f"{d['max_shares']:,}",
            jp("売却株数","Sold"): f"{d['sold']:,}",
            jp("売却圧力","Sell%"): f"{d['sell_pct_float']:.2f}%",
            jp("単独株価影響","Solo Price Impact"): f"${individual_est:.2f} (-${listing_price-individual_est:.2f})",
            jp("売却収益","Proceeds"): f"${d['proceeds']:,.0f}",
            jp("取得単価","Cost"): f"${d['cost']:.2f}" if d['cost'] else "N/A",
        })
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
    st.caption(jp(
        f"※ 株価モデル：売却圧力1%につき{SENSITIVITY}%下落（SPAC上場初日の低流動性を考慮した保守的推定）",
        f"※ Price model: {SENSITIVITY}% decline per 1% sell pressure (conservative estimate for low SPAC listing day liquidity)"
    ))

# ════════════════════════════════════════════════════════
# TAB 2: ROTH CEF 調達シミュレーター（ROTH一本）
# ════════════════════════════════════════════════════════
with tab2:
    st.subheader(jp("💰 ROTH CEF 調達シミュレーター","💰 ROTH CEF Financing Simulator"))
    st.caption(jp(
        "ROTH Principal の Committed Equity Facility をタームシート条件で試算。調達先はROTHのみ。",
        "ROTH Principal Committed Equity Facility per term sheet. ROTH only."
    ))

    raise_target = st.slider(jp("CEF調達目標額 ($)","CEF Target ($)"),
        ROTH_MIN, ROTH_MAX, ROTH_MIN, 5_000_000, key="roth_raise",
        help=jp("最低$10M〜最大枠$150M。Exchange Capで実際の上限は株価次第",
                "Min $10M to max $150M. Real cap depends on price via Exchange Cap"))
    fin_price = st.slider(jp("引き出し時の株価 (USD)","Draw Price (USD)"),1.0,25.0,10.0,0.5,format="$%.2f",key="fin_price")
    approved = st.checkbox(jp("株主承認あり（Exchange Cap 19.99%を解除）","Stockholder approval (lift 19.99% cap)"), value=False)

    issue_price = fin_price * (1 - ROTH_DISCOUNT)
    need_shares = raise_target / issue_price
    cap_shares  = TOTAL_SHARES * EXCHANGE_CAP_PCT
    actual_shares = need_shares if approved else min(need_shares, cap_shares)
    capped = (not approved) and need_shares > cap_shares
    actual_raise = actual_shares * issue_price
    roth_dilution = dil(actual_shares)
    nag_after = NAGANO_SHARES / (TOTAL_SHARES + actual_shares) * 100

    c1,c2,c3,c4 = st.columns(4)
    c1.metric(jp("実際の調達額","Actual Raise"), f"${actual_raise:,.0f}", f"{jp('目標','Target')} ${raise_target:,.0f}")
    c2.metric(jp("発行価格(97%VWAP)","Issue Price"), f"${issue_price:.2f}")
    c3.metric(jp("発行株数","Shares"), f"{actual_shares:,.0f}")
    c4.metric(jp("希薄化率","Dilution"), f"{roth_dilution:.1f}%")

    if capped:
        st.error(jp(f"🔴 Exchange Cap到達 — 株主承認なしでは{cap_shares:,.0f}株(19.99%)が上限。"
                    f"目標${raise_target:,.0f}に対し実際は${actual_raise:,.0f}しか引けない。株主承認で解除可。",
                    f"🔴 Exchange Cap hit — without approval, max is {cap_shares:,.0f} shares (19.99%). "
                    f"Only ${actual_raise:,.0f} of ${raise_target:,.0f} can be drawn."))
    else:
        st.success(jp(f"✅ 目標額を満額調達可能。希薄化{roth_dilution:.1f}%。"
                      f"（コミットメントフィー2%=${raise_target*COMMIT_FEE_PCT:,.0f}は別途）",
                      f"✅ Full target drawable. Dilution {roth_dilution:.1f}%."))

    st.metric(jp("発行後ナガノ比率","Nagano % after"), f"{nag_after:.2f}%",
        jp(f"拒否権ライン{BLOCK_LINE}%", f"Block line {BLOCK_LINE}%"),
        delta_color="inverse" if nag_after < BLOCK_LINE else "normal")
    if nag_after < BLOCK_LINE:
        st.warning(jp(f"⚠️ 発行後ナガノ {nag_after:.2f}% は拒否権ライン{BLOCK_LINE}%を下回る。増資は取締役会判断を。",
                      f"⚠️ Nagano {nag_after:.2f}% falls below {BLOCK_LINE}% block line. Board decision required."))

    st.divider()
    # 希薄化グラフ（株価レンジ）
    px_r=[i*0.5 for i in range(2,51)]
    fig_fin=go.Figure()
    fig_fin.add_trace(go.Scatter(x=px_r,
        y=[dil(min(raise_target/(p*(1-ROTH_DISCOUNT)), cap_shares)) for p in px_r],
        name=jp("ROTH希薄化(Capあり)","ROTH dil. (capped)"),line=dict(color="#2E86AB",width=2)))
    fig_fin.add_trace(go.Scatter(x=px_r,
        y=[dil(raise_target/(p*(1-ROTH_DISCOUNT))) for p in px_r],
        name=jp("ROTH希薄化(承認時)","ROTH dil. (approved)"),line=dict(color="#06A77D",width=2,dash="dash")))
    fig_fin.add_vline(x=fin_price,line_dash="dot",line_color="red",
        annotation_text=f"${fin_price:.1f}",annotation_position="top right")
    fig_fin.add_hrect(y0=0,y1=5,fillcolor="#1D9E75",opacity=0.05,line_width=0)
    fig_fin.add_hrect(y0=5,y1=10,fillcolor="#FFA500",opacity=0.05,line_width=0)
    fig_fin.add_hrect(y0=10,y1=35,fillcolor="#E24B4A",opacity=0.05,line_width=0)
    fig_fin.update_layout(xaxis_title="Stock Price (USD)",yaxis_title="Dilution (%)",
        legend=dict(orientation="h",y=1.05,x=0),height=300,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=10,t=40,b=30),font=dict(size=11))
    st.plotly_chart(fig_fin, use_container_width=True)

    with st.expander(jp("タームシート条件","Term Sheet Conditions")):
        st.markdown(jp(
            f"- 発行価格 = 当日VWAPの97%（3%ディスカウント）\n"
            f"- $1フロア：前日終値$1.00未満の日は引出不可\n"
            f"- Exchange Cap：株主承認なしでは発行済の19.99%（{cap_shares:,.0f}株）が上限\n"
            f"- 調達枠：最低$10M〜最大$150M、引出タイミングは会社裁量\n"
            f"- コミットメントフィー：枠の2.0%（未使用なら不発生）／ROTH保有上限4.99%\n"
            f"- 調達先はROTHのみ。最終条件・登録・税務はDEC確認",
            f"- Issue price = 97% of daily VWAP\n- $1 floor on prior close\n"
            f"- Exchange Cap 19.99% ({cap_shares:,.0f} sh) without approval\n"
            f"- $10M–$150M, company-controlled timing\n- 2% commitment fee / 4.99% ownership cap\n"
            f"- ROTH only. Confirm final terms with DEC"))

# ════════════════════════════════════════════════════════
# TAB 3: 希薄化分析（ROTH一本）
# ════════════════════════════════════════════════════════
with tab3:
    st.subheader(jp("📊 希薄化分析（ROTH CEF）","📊 Dilution Analysis (ROTH CEF)"))
    px2=st.slider(jp("株価","Stock Price"),1.0,25.0,10.0,0.5,format="$%.2f",key="px2")
    raise2=st.slider(jp("調達額 ($)","Raise ($)"),ROTH_MIN,ROTH_MAX,ROTH_MIN,5_000_000,key="raise2")
    cap_sh = TOTAL_SHARES * EXCHANGE_CAP_PCT
    ip2 = px2*(1-ROTH_DISCOUNT)
    need2 = raise2/ip2
    capped2 = dil(min(need2, cap_sh))
    appr2 = dil(need2)
    c1,c2,c3=st.columns(3)
    c1.metric(jp("希薄化(Capあり)","Dil. capped"),f"{capped2:.1f}%")
    c2.metric(jp("希薄化(承認時)","Dil. approved"),f"{appr2:.1f}%")
    c3.metric(jp("Exchange Cap","Exchange Cap"),f"{cap_sh:,.0f}株")
    px_r2=[i*0.5 for i in range(2,51)]
    fig_dil=go.Figure()
    fig_dil.add_trace(go.Scatter(x=px_r2,y=[dil(min(raise2/(p*(1-ROTH_DISCOUNT)),cap_sh)) for p in px_r2],
        name=jp("ROTH(Capあり)","ROTH (capped)"),line=dict(color="#2E86AB",width=2)))
    fig_dil.add_trace(go.Scatter(x=px_r2,y=[dil(raise2/(p*(1-ROTH_DISCOUNT))) for p in px_r2],
        name=jp("ROTH(承認時)","ROTH (approved)"),line=dict(color="#06A77D",width=2,dash="dash")))
    fig_dil.add_vline(x=px2,line_dash="dot",line_color="red",
        annotation_text=f"${px2:.1f}",annotation_position="top right")
    fig_dil.update_layout(xaxis_title="Stock Price (USD)",yaxis_title="Dilution (%)",
        legend=dict(orientation="h",y=1.05,x=0),height=320,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=10,t=40,b=30),font=dict(size=11))
    st.plotly_chart(fig_dil, use_container_width=True)

# ════════════════════════════════════════════════════════
# TAB 4: シナリオ予測
# ════════════════════════════════════════════════════════
with tab4:
    st.subheader(jp("📈 時価総額シナリオ予測","📈 Market Cap Scenario Forecast"))
    labels_y=["Listing","Y+1","Y+2","Y+3","Y+4","Y+5"]
    bear=[150,50,80,120,180,250]; base=[150,200,500,800,1200,2000]; bull=[150,500,1000,2000,3000,4000]
    fig_sc=go.Figure()
    fig_sc.add_trace(go.Scatter(x=labels_y,y=bear,name=jp("🔴 弱気","🔴 Bear"),
        line=dict(color="#E24B4A",width=2,dash="dash")))
    fig_sc.add_trace(go.Scatter(x=labels_y,y=base,name=jp("🟢 標準","🟢 Base"),
        line=dict(color="#1D9E75",width=3),fill="tonexty",fillcolor="rgba(29,158,117,0.06)"))
    fig_sc.add_trace(go.Scatter(x=labels_y,y=bull,name=jp("🔵 強気","🔵 Bull"),
        line=dict(color="#2563EB",width=2,dash="dot"),fill="tonexty",fillcolor="rgba(37,99,235,0.05)"))
    fig_sc.add_hline(y=1000,line_dash="dot",line_color="gray",annotation_text="$1B",annotation_position="right")
    fig_sc.add_hline(y=4000,line_dash="dot",line_color="#7C3AED",annotation_text="$4B",annotation_position="right")
    fig_sc.update_layout(yaxis_title=jp("時価総額 ($M)","Market Cap ($M)"),
        legend=dict(orientation="h",y=1.05,x=0),height=320,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=60,t=40,b=20),font=dict(size=11))
    st.plotly_chart(fig_sc, use_container_width=True)
    tbl_sc=pd.DataFrame({jp("年","Year"):labels_y,
        jp("🔴 弱気","🔴 Bear"):["$150M","$50M","$80M","$120M","$180M","$250M"],
        jp("🟢 標準","🟢 Base"):["$150M","$200M","$500M","$800M","$1.2B","$2B"],
        jp("🔵 強気","🔵 Bull"):["$150M","$500M","$1B","$2B","$3B","$4B"]})
    st.dataframe(tbl_sc, use_container_width=True, hide_index=True)

# ════════════════════════════════════════════════════════
# TAB 5: リスク分析
# ════════════════════════════════════════════════════════
with tab5:
    st.subheader(jp("⚠️ リスクマトリクス","⚠️ Risk Matrix"))
    risks=jp(["上場当日\n売却圧力","フロート\n枯渇","株価\n$1割れ","SPAC\n希薄化","CEF\nCap到達","競合\n参入","規制\n変更"],
             ["Day-1\nSell Pressure","Float\nDepletion","Price\n<$1","SPAC\nDilution","CEF Cap\nHit","Competition","Regulation"])
    prob=[0.7,0.8,0.5,0.5,0.6,0.3,0.4]; impact=[0.8,0.85,0.9,0.6,0.5,0.5,0.6]
    colors_r=["#E24B4A","#E24B4A","#E24B4A","#F97316","#F97316","#FCD34D","#FCD34D"]
    fig_risk=go.Figure()
    fig_risk.add_trace(go.Scatter(x=prob,y=impact,mode="markers+text",text=risks,
        textposition="top center",marker=dict(size=18,color=colors_r,opacity=0.85)))
    fig_risk.add_vline(x=0.5,line_dash="dot",line_color="gray")
    fig_risk.add_hline(y=0.5,line_dash="dot",line_color="gray")
    fig_risk.update_layout(xaxis=dict(title="Probability",range=[0,1.1],tickformat=".0%"),
        yaxis=dict(title="Impact",range=[0,1.1],tickformat=".0%"),
        height=320,plot_bgcolor="#FAFAFA",paper_bgcolor="white",
        margin=dict(l=5,r=5,t=10,b=30),font=dict(size=10),showlegend=False)
    st.plotly_chart(fig_risk, use_container_width=True)

# ════════════════════════════════════════════════════════
# TAB 6: 意思決定（ROTH一本）
# ════════════════════════════════════════════════════════
with tab6:
    st.subheader(jp("🎯 経営判断サマリー（最新）","🎯 Management Decision Summary (Latest)"))

    st.markdown(f"**{jp('📋 資金調達ステータス','📋 Financing Status')}**")
    s1,s2 = st.columns(2)
    with s1:
        st.success(jp("🟢 ROTH CEF\n上場後の調達手段として推進（$10M〜$150M枠）",
                      "🟢 ROTH CEF\nPost-listing financing ($10M–$150M)"))
    with s2:
        st.info(jp("ℹ️ 調達先はROTHのみ\n他の資金調達先とは取引しない方針",
                   "ℹ️ ROTH only\nNo other counterparties"))

    st.markdown("---")
    decisions=[
        ("🔴",jp("上場当日の売却圧力対策 — Sponsor・New Publicへのロックアップ交渉を急ぐ",
                  "Urgently negotiate lockup with Sponsor & New Public to prevent Day-1 collapse")),
        ("🟢",jp("ROTH CEF — 上場後の資金調達として継続推進。上場10営業日以内にS-1提出準備",
                  "ROTH CEF — continue as post-listing financing. Prepare S-1 within 10 business days")),
        ("🟡",jp("CEF引出は株価が育ってから — $2近辺でのフル発行は希薄化が重い。$4以上を目安に",
                  "Draw CEF after price recovers — full draw near $2 dilutes heavily. Target $4+")),
        ("🔴",jp("$1フロア注意 — 株価$1割れでCEFが引出不可になる。フロート確保が最優先",
                  "$1 floor — CEF undrawable if price <$1. Securing float is top priority")),
        ("🔴",jp("ナガノ拒否権 — 発行前29.19%で既に33.34%を下回る。増資は取締役会判断必須",
                  "Nagano block rights — 29.19% already below 33.34%. Board decision required for issuance")),
    ]
    for icon,text in decisions:
        if icon=="🔴": st.error(f"{icon} {text}")
        elif icon=="🟢": st.success(f"{icon} {text}")
        elif icon=="🟡": st.warning(f"{icon} {text}")
        else: st.info(f"{icon} {text}")

    st.markdown("---")
    tl={
        jp("🚨 今すぐ（最優先）","🚨 Now (Top Priority)"):[
            jp("Sponsor・New Publicへのロックアップ交渉を開始（上場当日の売却圧力対策）",
               "Begin lockup negotiation with Sponsor & New Public"),
            jp("フロート確保策の検討（薄商い・$1フロア割れリスクの低減）",
               "Secure float to reduce thin-trading and $1-floor risk"),
        ],
        jp("📅 上場前","📅 Pre-Listing"):[
            jp("ROTH CEF契約の最終確認（上場後CEF開始の条件整理）",
               "Finalize ROTH CEF terms for post-listing activation"),
            jp("ナガノ拒否権ライン（33.34%）を踏まえた発行計画を取締役会で確認",
               "Confirm issuance plan vs Nagano 33.34% block line at board"),
        ],
        jp("📅 NASDAQ上場","📅 NASDAQ Listing"):[
            jp("上場当日の売却圧力モニタリング体制を整備","Set up Day-1 sell pressure monitoring"),
            jp("NASDAQ上場承認・取引開始","NASDAQ listing approval and trading begins"),
        ],
        jp("📅 上場後","📅 Post-Listing"):[
            jp("ROTH CEF開始 — S-1提出（上場後10営業日以内）",
               "ROTH CEF commences — S-1 filed within 10 business days"),
            jp("株価が$4以上に育った段階でCEFを分割引出（希薄化最小化）",
               "Draw CEF in tranches once price exceeds $4 to minimize dilution"),
        ],
    }
    for phase,actions in tl.items():
        with st.expander(phase, expanded=("今すぐ" in phase or "Now" in phase)):
            for a in actions: st.markdown(f"- {a}")



# ════════════════════════════════════════════════════════
# TAB 7: Sponsor/CHARDAN 売り抜けモンテカルロ
# ════════════════════════════════════════════════════════
with tab7:
    import numpy as np
    st.subheader(jp("🎲 Sponsor/CHARDAN 売り抜けシミュレーター","🎲 Sponsor/CHARDAN Dump Simulator"))
    st.caption(jp(
        "取得単価ゼロ同然のSponsor・CHARDANが上場初日にどれだけ売り、株価がどこまで落ち、いくら現金を抜くかを1万通りで試算。",
        "Monte Carlo of zero-cost Sponsor/CHARDAN dumping on Day-1: shares sold, price impact, cash extracted."
    ))

    SP_SPONSOR = 5_515_481
    SP_CHARDAN = 1_615_385
    SP_COMBINED = SP_SPONSOR + SP_CHARDAN
    SP_FLOAT = FLOAT_SHARES
    SP_SENS = SENSITIVITY

    cset1, cset2 = st.columns(2)
    with cset1:
        sp_low  = st.slider(jp("悲観の初値 ($)","Bear open ($)"), 0.5, 5.0, 2.0, 0.1, key="sp_low")
        sp_mode = st.slider(jp("最頻の初値 ($)","Mode open ($)"), 1.0, 10.0, 4.0, 0.1, key="sp_mode")
        sp_high = st.slider(jp("楽観の初値 ($)","Bull open ($)"), 2.0, 15.0, 6.0, 0.1, key="sp_high")
    with cset2:
        sp_d1_lo = st.slider(jp("初日に投げる割合 最小","Day-1 dump min"), 0.0, 1.0, 0.70, 0.05, key="sp_d1lo")
        sp_d1_md = st.slider(jp("初日に投げる割合 最頻","Day-1 dump mode"), 0.0, 1.0, 0.85, 0.05, key="sp_d1md")
        rule144 = st.checkbox(jp("Rule 144制限を適用（四半期1%上限）","Apply Rule 144 (1%/qtr cap)"), value=False, key="sp_144")

    if not (sp_low <= sp_mode <= sp_high) or not (sp_d1_lo <= sp_d1_md <= 1.0):
        st.error(jp("入力は 悲観≤最頻≤楽観、最小≤最頻≤1.0 の順で。","Inputs must be ordered."))
    else:
        rng = np.random.default_rng(42)
        N = 10000
        p0 = rng.triangular(sp_low, sp_mode, sp_high, N)
        sell_prob = np.clip(0.30 + (p0 - 1.0) * 0.07, 0.30, 0.97)
        will_sell = rng.random(N) < sell_prob
        d1_frac = rng.triangular(sp_d1_lo, sp_d1_md, 1.0, N)
        day1_shares = np.where(will_sell, SP_COMBINED * d1_frac, 0)
        if rule144:
            cap144 = TOTAL_SHARES * 0.01  # 四半期1%
            day1_shares = np.minimum(day1_shares, cap144)
        sell_pct_float = day1_shares / SP_FLOAT * 100
        price_after = np.maximum(0.10, p0 * (1 - sell_pct_float * SP_SENS / 100))
        avg_price = (p0 + price_after) / 2
        proceeds = day1_shares * avg_price

        m1, m2, m3, m4 = st.columns(4)
        m1.metric(jp("初日売却株数 中央値","Median shares sold"), f"{np.median(day1_shares):,.0f}",
                  jp(f"フロートの{np.median(sell_pct_float):.0f}%", f"{np.median(sell_pct_float):.0f}% of float"))
        m2.metric(jp("初日終値 中央値","Median Day-1 close"), f"${np.median(price_after):.2f}")
        m3.metric(jp("彼らが抜く現金 中央値","Median cash extracted"), f"${np.median(proceeds):,.0f}")
        m4.metric(jp("初日に売る確率","P(sell Day-1)"), f"{will_sell.mean()*100:.0f}%")

        prob_half = (price_after < p0*0.5).mean()*100
        prob_1 = (price_after < 1.0).mean()*100
        prob_10m = (proceeds > 10_000_000).mean()*100
        st.info(jp(
            f"半値以下に落ちる確率 {prob_half:.0f}% ／ $1割れ確率 {prob_1:.0f}% ／ 彼らが$1000万超を抜く確率 {prob_10m:.0f}%",
            f"P(price<half) {prob_half:.0f}% / P(price<$1) {prob_1:.0f}% / P(cash>$10M) {prob_10m:.0f}%"))

        if rule144:
            st.success(jp("✅ Rule 144制限ON — 四半期1%上限で初日の大量放出が物理的に抑えられている。",
                          "✅ Rule 144 ON — 1%/qtr cap physically limits Day-1 dumping."))
        else:
            st.error(jp("🔴 Rule 144制限OFF — 登録済み等で制限がなければ、初日に大量放出が可能。DECに登録状況を要確認。",
                        "🔴 Rule 144 OFF — without limits, mass Day-1 dump is possible. Confirm registration with DEC."))

        # 初日終値の分布
        fig_sp1 = go.Figure()
        fig_sp1.add_trace(go.Histogram(x=price_after, nbinsx=50, marker_color="#C73E1D"))
        fig_sp1.add_vline(x=np.median(price_after), line_dash="dot", line_color="navy",
                          annotation_text=jp(f"中央値 ${np.median(price_after):.2f}", f"Median ${np.median(price_after):.2f}"))
        fig_sp1.add_vline(x=1.0, line_dash="dash", line_color="red",
                          annotation_text="$1")
        fig_sp1.update_layout(height=280, xaxis_title=jp("初日終値 ($)","Day-1 close ($)"),
                              yaxis_title=jp("頻度","Freq"), margin=dict(l=5,r=5,t=20,b=30),
                              plot_bgcolor="white", paper_bgcolor="white", font=dict(size=11))
        st.plotly_chart(fig_sp1, use_container_width=True)

        # 彼らが抜く現金の分布
        fig_sp2 = go.Figure()
        fig_sp2.add_trace(go.Histogram(x=proceeds/1e6, nbinsx=50, marker_color="#F5A623"))
        fig_sp2.add_vline(x=np.median(proceeds)/1e6, line_dash="dot", line_color="navy",
                          annotation_text=jp(f"中央値 ${np.median(proceeds)/1e6:.1f}M", f"Median ${np.median(proceeds)/1e6:.1f}M"))
        fig_sp2.update_layout(height=280, xaxis_title=jp("彼らが抜く現金 ($M・取得ゼロなので全額利益)","Cash extracted ($M, ~all profit)"),
                              yaxis_title=jp("頻度","Freq"), margin=dict(l=5,r=5,t=20,b=30),
                              plot_bgcolor="white", paper_bgcolor="white", font=dict(size=11))
        st.plotly_chart(fig_sp2, use_container_width=True)

        with st.expander(jp("前提・注記","Assumptions")):
            st.markdown(jp(
                f"- 対象：Sponsor {SP_SPONSOR:,}株 + CHARDAN {SP_CHARDAN:,}株 = {SP_COMBINED:,}株\n"
                f"- 取得単価ゼロ同然（Sponsor $0.0001 / CHARDAN実質無償）→ 何で売っても利益\n"
                f"- 5年待った我慢の限界 → 上場初日に集中売却の仮説\n"
                f"- 売る確率は株価が高いほど上昇（$1で30%→$10で95%）\n"
                f"- 薄商い：売圧1%につき株価{SP_SENS}%下落\n"
                f"- Rule 144 ONで四半期1%上限。登録状況はDEC確認。これは計画用の仮説ツール。",
                f"- Target: Sponsor {SP_SPONSOR:,} + CHARDAN {SP_CHARDAN:,} = {SP_COMBINED:,}\n"
                f"- ~Zero cost basis → all proceeds are profit\n- Day-1 concentrated dump hypothesis\n"
                f"- Sell probability rises with price\n- {SP_SENS}% drop per 1% sell pressure\n"
                f"- Rule 144 caps at 1%/qtr. Confirm registration with DEC."))


# ════════════════════════════════════════════════════════
# SIDEBAR: 株価モニター + AI参謀チーム
# ════════════════════════════════════════════════════════
with st.sidebar:
    st.markdown(f"## 📈 {jp('株価モニター','Stock Monitor')}")
    WATCHLIST = {
        jp("🏢 自社（SPAC）","🏢 Own (SPAC)"): [("ACQC", "Relativity / BIOT (OTC)")],
        jp("💉 幹細胞・再生医療","💉 Stem Cell / Regen."): [
            ("MESO","Mesoblast"),("ILIU","iLius / Lineage Cell"),("PLU","Pluri Inc."),
            ("FATE","Fate Therapeutics"),("KRTX","Karuna / Cell Therapy")],
        jp("💄 化粧品・美容医療","💄 Cosmetics / Aesthetics"): [
            ("ELF","e.l.f. Beauty"),("SKIN","The Beauty Health (Hydrafacial)"),
            ("AEYE","AudioEye / MedSpa Tech"),("ISRG","Intuitive Surgical")],
        jp("🧬 バイオ・医薬品","🧬 Biopharma"): [
            ("AMGN","Amgen"),("REGN","Regeneron"),("VRTX","Vertex Pharma")],
        jp("📊 業界ETF","📊 Sector ETFs"): [
            ("IBB","iShares Biotech ETF"),("XBI","SPDR Biotech ETF"),("ARKG","ARK Genomics ETF")],
    }
    def fetch_price(sym):
        try:
            t=yf.Ticker(sym); hist=t.history(period="2d")
            if hist.empty or len(hist)<1: return None
            cur=float(hist["Close"].iloc[-1])
            prev=float(hist["Close"].iloc[-2]) if len(hist)>=2 else cur
            chg=cur-prev; pct=chg/prev*100 if prev else 0
            return {"price":cur,"change":chg,"pct":pct}
        except: return None

    st.caption(jp("15分遅延 | yfinance","15-min delay | yfinance"))
    acqc=fetch_price("ACQC")
    if acqc:
        clr_a="#1D9E75" if acqc["change"]>=0 else "#E24B4A"
        arrow_a="▲" if acqc["change"]>=0 else "▼"
        listing_sim=st.session_state.get("listing_price_val",10.0)
        gap=listing_sim-acqc["price"]; gap_pct=gap/acqc["price"]*100 if acqc["price"] else 0
        st.markdown(f"""
<div style="background:#EFF6FF;border-radius:10px;padding:10px 12px;margin-bottom:4px;border:2px solid #2563EB">
<div style="font-size:11px;color:#1E40AF;font-weight:700">🏢 ACQC | Relativity / BIOT</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
  <span style="font-size:22px;font-weight:800;color:#1E293B">${acqc['price']:.2f}</span>
  <span style="font-size:13px;font-weight:700;color:{clr_a}">{arrow_a} {acqc['pct']:+.2f}%</span>
</div>
<div style="font-size:11px;color:#64748B;margin-top:4px">
  {jp('上場シミュ','Sim')} ${listing_sim:.2f} → {jp('差分','Gap')}: <b style="color:{'#E24B4A' if gap>0 else '#1D9E75'}">${gap:+.2f} ({gap_pct:+.1f}%)</b>
</div>
</div>""", unsafe_allow_html=True)
    else:
        st.markdown(f"""
<div style="background:#EFF6FF;border-radius:10px;padding:10px 12px;margin-bottom:4px;border:2px solid #2563EB">
<div style="font-size:11px;color:#1E40AF;font-weight:700">🏢 ACQC | Relativity / BIOT</div>
<div style="font-size:12px;color:#94A3B8;margin-top:4px">{jp('取得中…','Fetching…')}</div>
</div>""", unsafe_allow_html=True)

    if st.button(jp("🔄 更新","🔄 Refresh"), key="refresh_all", use_container_width=True):
        st.rerun()
    st.divider()

    industry_cats={k:v for k,v in WATCHLIST.items() if "自社" not in k and "Own" not in k}
    selected_cat=st.selectbox(jp("📂 業種カテゴリ","📂 Sector Category"),list(industry_cats.keys()),key="watch_cat")
    for sym,name in industry_cats[selected_cat]:
        data=fetch_price(sym)
        if data:
            clr="#1D9E75" if data["change"]>=0 else "#E24B4A"
            arrow="▲" if data["change"]>=0 else "▼"
            st.markdown(f"""
<div style="background:#F8FAFC;border-radius:8px;padding:8px 10px;margin-bottom:5px;border:1px solid #E2E8F0">
<div style="font-size:11px;color:#64748B;font-weight:600">{sym} | {name}</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
  <span style="font-size:17px;font-weight:700;color:#1E293B">${data['price']:.2f}</span>
  <span style="font-size:12px;font-weight:600;color:{clr}">{arrow} {data['pct']:+.2f}%</span>
</div>
</div>""", unsafe_allow_html=True)
        else:
            st.markdown(f"""
<div style="background:#F8FAFC;border-radius:8px;padding:8px 10px;margin-bottom:5px;border:1px solid #E2E8F0">
<div style="font-size:11px;color:#64748B">{sym} | {name}</div>
<div style="font-size:12px;color:#94A3B8">{jp('取得中…','Fetching…')}</div>
</div>""", unsafe_allow_html=True)

    st.divider()
    st.markdown(f"## 🤖 {jp('AI参謀チーム','AI Advisor Team')}")
    st.caption(jp("Dify連携 | シミュレーター数値を自動送信","Dify Integration | Auto-sends simulator data"))
    st.divider()

    keys_ok={role:bool(key) for role,key in DIFY_KEYS.items()}
    advisor_labels={"統括参謀":jp("🧠 統括参謀","🧠 Chief Advisor"),
        "CFO参謀":jp("💼 CFO参謀","💼 CFO Advisor"),"情報参謀":jp("🔍 情報参謀","🔍 Intel Advisor")}
    selected_role=st.radio(jp("参謀を選択","Select Advisor"),list(DIFY_KEYS.keys()),
        format_func=lambda r:advisor_labels[r],key="advisor_select")
    api_key=DIFY_KEYS[selected_role]
    key_status="✅ 接続済" if keys_ok[selected_role] else "❌ 未設定"
    st.caption(f"{advisor_labels[selected_role]}　{key_status}")
    st.divider()

    def build_context():
        try:
            lp=st.session_state.get("listing_price_val",10.0)
            sp=st.session_state.get("sell_pct_float_val",0.0)
            ep=st.session_state.get("est_price_val",10.0)
            return jp(f"""【BIOTシミュレーター現在値】
上場基準価格:${lp:.2f} / 売却圧力:{sp:.1f}% / 推定終値:${ep:.2f}
発行済:41,254,857株 / 流通株:18,882,313株
資金調達:ROTH CEFのみ（$10M〜$150M枠・上場後）。他社とは取引しない。""",
f"""[BIOT Simulator Values]
Listing:${lp:.2f} / Sell Pressure:{sp:.1f}% / Est.Price:${ep:.2f}
Total:41,254,857 / Float:18,882,313
Financing: ROTH CEF only ($10M-$150M, post-listing). No other counterparties.""")
        except:
            return ""

    st.markdown(f"**{jp('クイック質問','Quick Questions')}**")
    quick_jp={
        "統括参謀":["今すぐ打つべき最優先の経営判断を教えて","CHARDANとSponsorが全株売った場合のリスクと対策","NASDAQ上場後の株価防衛戦略を立案して"],
        "CFO参謀":["ROTH CEFの最適な引出タイミングを教えて","株価$2でCEFをフル発行した場合の希薄化は？","ナガノ拒否権ラインを守る発行計画を提案して"],
        "情報参謀":["SPAC上場当日の売却圧力の最新市場動向を教えて","上場当日に株価が崩壊したSPAC事例を調べて","CHARDANのSPAC案件での過去の行動パターンを調査"],
    }
    quick_en={
        "統括参謀":["Top management decision I should make right now?","Risk if CHARDAN and Sponsor sell all shares","Post-listing stock price defense strategy"],
        "CFO参謀":["Optimal timing for ROTH CEF draws?","Dilution if CEF fully drawn at $2?","Issuance plan to preserve Nagano block rights"],
        "情報参謀":["Latest trends on SPAC Day-1 sell pressure","SPACs where stock collapsed on Day-1","CHARDAN's past behavior in SPAC deals"],
    }
    quick_questions=quick_jp[selected_role] if lang=="JP" else quick_en[selected_role]
    quick_input=None
    for i,q in enumerate(quick_questions):
        if st.button(f"Q{i+1} {q[:20]}…" if len(q)>20 else f"Q{i+1} {q}",
                     key=f"qk_{selected_role}_{i}",use_container_width=True):
            quick_input=q
    st.divider()

    chat_history=st.session_state[f"chat_{selected_role}"]
    for msg in chat_history[-6:]:
        with st.chat_message(msg["role"],avatar="👔" if msg["role"]=="user" else "🤖"):
            st.markdown(msg["content"])

    user_input=st.chat_input(jp(f"{selected_role}に質問…",f"Ask {selected_role}…"),key=f"sb_input_{selected_role}")
    if quick_input:
        user_input=quick_input
    if user_input:
        if not api_key:
            st.error(jp("⚠️ APIキー未設定","⚠️ API key not set"))
        else:
            context=build_context()
            full_message=f"{context}\n\n{jp('BOSSからの質問：','BOSS: ')}{user_input}" if context else user_input
            chat_history.append({"role":"user","content":user_input})
            with st.chat_message("user",avatar="👔"):
                st.markdown(user_input)
            with st.chat_message("assistant",avatar="🤖"):
                with st.spinner(jp("分析中…","Analyzing…")):
                    conv_id=st.session_state[f"conv_id_{selected_role}"]
                    result=call_dify(api_key,full_message,conv_id)
                if result["ok"]:
                    st.markdown(result["answer"])
                    chat_history.append({"role":"assistant","content":result["answer"]})
                    st.session_state[f"conv_id_{selected_role}"]=result["conv_id"]
                else:
                    st.error(result["answer"])
            st.session_state[f"chat_{selected_role}"]=chat_history
            st.rerun()

    if chat_history:
        if st.button(jp("🔄 会話リセット","🔄 Reset"),key=f"sb_reset_{selected_role}",use_container_width=True):
            st.session_state[f"chat_{selected_role}"]=[]
            st.session_state[f"conv_id_{selected_role}"]=""
            st.rerun()

st.divider()
st.caption(jp("Instinct Brothers Holdings | 統合資本管理シミュレーター | 社外秘 | 2026",
              "Instinct Brothers Holdings | Integrated Capital Simulator | Confidential | 2026"))
