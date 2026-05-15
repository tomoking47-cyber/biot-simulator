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
st.caption(jp("Instinct Brothers Holdings | 発行済株数 31,225,944株 | 社外秘",
              "Instinct Brothers Holdings | 31,225,944 shares | CONFIDENTIAL"))
days_left = (date(2026,6,2) - date.today()).days
st.metric("⏰ Kadenwood Deadline", f"{days_left} {'日' if lang=='JP' else 'days'}", delta="URGENT", delta_color="inverse")
st.divider()

# ── 定数 ──
TOTAL_SHARES = 31_225_944
FLOAT_SHARES = 18_882_313
KW_AMT = 5_000_000
ROTH_AMT = 10_000_000
YK_AMT = 3_000_000
YK_FLOOR = 1.00
SENSITIVITY = 1.5  # 1%売圧 → 1.5%株価下落

SHAREHOLDERS = [
    ("Nagano Tomoki",        "Nagano Tomoki",          12_079_500, 12,   None,  False),
    ("New Public",           "New Public Stockholders",  9_970_500,  0,  10.00, True),
    ("Public Stockholders",  "Public Stockholders",         43_742,  0,  10.00, True),
    ("Initial Stockholders", "Initial Stockholders",       738_369,  0,  10.00, True),
    ("Sponsor (Relativity)", "Sponsor (Relativity)",     5_515_481,  0,   None, True),
    ("Everise Concepts",     "Everise Concepts",            450_000, 12,   None, False),
    ("CHARDAN",              "CHARDAN",                  1_615_385,  0,   3.25, True),
    ("TN NOMURA",            "TN NOMURA",                   19_316,  0,   3.25, True),
    ("Kadenwood",            "Kadenwood",                  793_651,  6,   6.30, False),
]
sellable = [(r[0],r[1],r[2],r[4]) for r in SHAREHOLDERS if r[5]]
locked   = [(r[0],r[1],r[2],r[3]) for r in SHAREHOLDERS if not r[5]]

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
# Streamlit Secretsからも読む（本番用）
try:
    if st.secrets.get("DIFY_KEY_GENERAL"): DIFY_KEYS["統括参謀"] = st.secrets["DIFY_KEY_GENERAL"]
    if st.secrets.get("DIFY_KEY_CFO"):     DIFY_KEYS["CFO参謀"]  = st.secrets["DIFY_KEY_CFO"]
    if st.secrets.get("DIFY_KEY_INFO"):    DIFY_KEYS["情報参謀"] = st.secrets["DIFY_KEY_INFO"]
except: pass

import requests, json

def call_dify(api_key: str, user_message: str, conversation_id: str = "") -> dict:
    """Dify Chat API呼び出し"""
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "inputs": {},
        "query": user_message,
        "response_mode": "blocking",
        "user": "biot-boss",
    }
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

# セッション：会話履歴・conversation_id
for role in ["統括参謀","CFO参謀","情報参謀"]:
    if f"chat_{role}" not in st.session_state:
        st.session_state[f"chat_{role}"] = []
    if f"conv_id_{role}" not in st.session_state:
        st.session_state[f"conv_id_{role}"] = ""

# ── タブ ──
tab1,tab2,tab3,tab4,tab5,tab6 = st.tabs([
    jp("🏦 上場当日 株価予測","🏦 Day-1 Price Forecast"),
    jp("💰 資金調達シミュ","💰 Financing Sim"),
    jp("📊 希薄化分析","📊 Dilution"),
    jp("📈 シナリオ予測","📈 Scenarios"),
    jp("⚠️ リスク分析","⚠️ Risk"),
    jp("🎯 意思決定","🎯 Decision"),
])

# ════════════════════════════════════════════════════════
# TAB 1: 上場当日 株価予測（メインダッシュボード）
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
        "CHARDAN":"🔴", "Sponsor (Relativity)":"🔴", "New Public":"🟠",
        "Initial Stockholders":"🟡","Public Stockholders":"🟡","TN NOMURA":"🟢",
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

    # ── 合計計算 ──
    total_sold       = sum(d["sold"] for d in sell_data)
    total_proceeds   = sum(d["proceeds"] for d in sell_data)
    sell_pct_float   = total_sold / FLOAT_SHARES * 100
    sell_pct_total   = total_sold / TOTAL_SHARES * 100
    est_price        = calc_price(listing_price, sell_pct_float)
    price_drop_abs   = listing_price - est_price
    price_drop_pct   = price_drop_abs / listing_price * 100

    # ══ 最重要KPI：株価がいくらになるか ══
    st.markdown("---")
    st.markdown(f"## {jp('📉 上場当日の推定株価','📉 Estimated Stock Price on Listing Day')}")

    # 大きく目立つ株価表示
    col_big1, col_big2, col_big3 = st.columns(3)
    col_big1.metric(
        jp("上場基準価格","Listing Price"),
        f"${listing_price:.2f}",
    )
    col_big2.metric(
        jp("🎯 推定終値（売却後）","🎯 Est. Closing Price"),
        f"${est_price:.2f}",
        f"-${price_drop_abs:.2f}  (-{price_drop_pct:.1f}%)",
        delta_color="inverse"
    )
    col_big3.metric(
        jp("総売却圧力","Total Sell Pressure"),
        f"{sell_pct_float:.1f}%",
        jp(f"流通株の{sell_pct_float:.1f}%が売却",f"{sell_pct_float:.1f}% of float sold")
    )

    # 株価レベル判定
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

    # CHARDANの取得単価との比較
    if est_price < 3.25:
        st.error(jp(f"⚠️ 推定株価 ${est_price:.2f} < CHARDAN取得単価 $3.25 → CHARDANは損失。売却インセンティブが下がる可能性。",
                    f"⚠️ Est. price ${est_price:.2f} < CHARDAN cost $3.25 → CHARDAN takes a loss. May reduce sell incentive."))

    st.markdown("---")

    # ── グラフ①：株主別売却株数 → 個別株価影響（横棒） ──
    st.markdown(f"### {jp('① 株主別売却株数と株価への影響','① Shares Sold & Price Impact per Shareholder')}")
    bar_names  = [d["name"] for d in sell_data]
    bar_sold   = [d["sold"] for d in sell_data]
    bar_impact = [listing_price - calc_price(listing_price, d["sell_pct_float"]) for d in sell_data]

    fig1 = go.Figure()
    fig1.add_trace(go.Bar(
        name=jp("売却株数","Shares Sold"),
        x=bar_names, y=bar_sold,
        marker_color=["#E24B4A" if s>0 else "#D1D5DB" for s in bar_sold],
        yaxis="y1", offsetgroup=1
    ))
    fig1.add_trace(go.Scatter(
        name=jp("株価下落幅 ($)","Price Drop ($)"),
        x=bar_names, y=bar_impact,
        mode="markers+lines",
        marker=dict(size=10, color="#7C3AED"),
        line=dict(color="#7C3AED", width=2, dash="dot"),
        yaxis="y2"
    ))
    fig1.update_layout(
        yaxis=dict(title=jp("売却株数","Shares Sold"), showgrid=False),
        yaxis2=dict(title=jp("株価下落幅 ($)","Price Drop ($)"),
                    overlaying="y", side="right", showgrid=False),
        legend=dict(orientation="h", y=1.08, x=0),
        height=300, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=60,t=50,b=60), font=dict(size=10),
        barmode="group"
    )
    st.plotly_chart(fig1, use_container_width=True)

    # ── グラフ②：売却圧力 → 推定株価 ゲージチャート ──
    st.markdown(f"### {jp('② 売却圧力 → 推定株価 リアルタイムゲージ','② Sell Pressure → Est. Stock Price Gauge')}")

    fig2 = go.Figure()
    # 背景カラーゾーン
    px_range = [i*0.5 for i in range(0,61)]
    price_curve = [calc_price(listing_price, p) for p in px_range]
    fig2.add_trace(go.Scatter(
        x=px_range, y=price_curve, mode="lines",
        fill="tozeroy", fillcolor="rgba(226,75,74,0.07)",
        line=dict(color="#E24B4A", width=3),
        name=jp("推定株価","Est. Price")
    ))
    # 現在の売却圧力マーカー（大きく目立つ）
    fig2.add_trace(go.Scatter(
        x=[sell_pct_float], y=[est_price],
        mode="markers+text",
        text=[f"  ${est_price:.2f}"],
        textfont=dict(size=16, color="#1E40AF"),
        textposition="middle right",
        marker=dict(size=18, color="#1E40AF", symbol="circle",
                    line=dict(color="white", width=2)),
        name=jp("現在の売却圧力","Current Sell Pressure")
    ))
    # 基準ライン
    fig2.add_hline(y=listing_price, line_dash="dash", line_color="#1D9E75",
        annotation_text=jp(f"上場価格 ${listing_price:.2f}",f"Listing ${listing_price:.2f}"),
        annotation_position="right")
    fig2.add_hline(y=3.25, line_dash="dot", line_color="#F97316",
        annotation_text="CHARDAN cost $3.25", annotation_position="right")
    fig2.add_hline(y=listing_price*0.5, line_dash="dot", line_color="#E24B4A",
        annotation_text=jp("50%下落ライン","50% drop line"), annotation_position="right")
    # ゾーン色
    fig2.add_hrect(y0=listing_price*0.9, y1=listing_price*1.1,
        fillcolor="#1D9E75", opacity=0.07, line_width=0,
        annotation_text=jp("安全ゾーン","Safe"), annotation_position="left")
    fig2.add_hrect(y0=listing_price*0.7, y1=listing_price*0.9,
        fillcolor="#FCD34D", opacity=0.07, line_width=0,
        annotation_text=jp("注意","Caution"), annotation_position="left")
    fig2.add_hrect(y0=0, y1=listing_price*0.7,
        fillcolor="#E24B4A", opacity=0.07, line_width=0,
        annotation_text=jp("危険","Danger"), annotation_position="left")
    fig2.update_layout(
        xaxis=dict(title=jp("売却圧力（流通株に対する売却割合%）","Sell Pressure (% of Float)"), range=[0,62]),
        yaxis=dict(title=jp("推定株価 ($)","Est. Stock Price ($)"), range=[0, listing_price*1.15]),
        height=380, plot_bgcolor="white", paper_bgcolor="white",
        legend=dict(orientation="h", y=1.05, x=0),
        margin=dict(l=5,r=80,t=50,b=40), font=dict(size=11)
    )
    st.plotly_chart(fig2, use_container_width=True)

    # ── グラフ③：シナリオ別 株価予測バー（最悪〜最良） ──
    st.markdown(f"### {jp('③ シナリオ別 上場当日 推定株価','③ Day-1 Estimated Price by Scenario')}")

    scenarios_jp = ["全員売らない\n（理想）","CHARDANのみ\n売却","CHARDAN+\nInitial売却","CHARDAN+\nSponsor売却","流通株の\n50%売却","流通株の\n全部売却"]
    scenarios_en = ["Nobody Sells\n(Ideal)","CHARDAN Only\nSells","CHARDAN+\nInitial Sell","CHARDAN+\nSponsor Sell","50% of\nFloat Sells","All Float\nSells"]
    scenario_names = scenarios_jp if lang=="JP" else scenarios_en

    # 各シナリオの売却圧力
    chardan_pct    = 1_615_385 / FLOAT_SHARES * 100
    initial_pct    = (1_615_385 + 738_369) / FLOAT_SHARES * 100
    sponsor_pct    = (1_615_385 + 5_515_481) / FLOAT_SHARES * 100
    half_pct       = 50.0
    all_pct        = 100.0

    scenario_pressures = [0, chardan_pct, initial_pct, sponsor_pct, half_pct, all_pct]
    scenario_prices    = [calc_price(listing_price, p) for p in scenario_pressures]
    scenario_drops     = [listing_price - p for p in scenario_prices]
    bar_colors_s = ["#1D9E75" if p>=listing_price*0.9
                    else "#FCD34D" if p>=listing_price*0.7
                    else "#F97316" if p>=listing_price*0.5
                    else "#E24B4A" for p in scenario_prices]

    fig3 = go.Figure()
    fig3.add_trace(go.Bar(
        x=scenario_names, y=scenario_prices,
        marker_color=bar_colors_s,
        text=[f"${p:.2f}" for p in scenario_prices],
        textposition="outside", textfont=dict(size=13, color="#1E1E1E"),
    ))
    # 現在のシミュレーション値
    fig3.add_hline(y=est_price, line_dash="dot", line_color="#1E40AF", line_width=2,
        annotation_text=jp(f"現在設定: ${est_price:.2f}",f"Current sim: ${est_price:.2f}"),
        annotation_position="right")
    fig3.add_hline(y=listing_price, line_dash="dash", line_color="#6B7280",
        annotation_text=jp(f"上場価格 ${listing_price:.2f}",f"Listing ${listing_price:.2f}"),
        annotation_position="right")
    fig3.update_layout(
        yaxis=dict(title=jp("推定株価 ($)","Est. Stock Price ($)"),
                   range=[0, listing_price*1.2]),
        height=320, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=80,t=20,b=10), font=dict(size=11),
        showlegend=False
    )
    st.plotly_chart(fig3, use_container_width=True)

    # シナリオ表
    tbl_s = pd.DataFrame({
        jp("シナリオ","Scenario"): scenario_names,
        jp("売却圧力","Sell Pressure"): [f"{p:.1f}%" for p in scenario_pressures],
        jp("推定株価","Est. Price"): [f"${p:.2f}" for p in scenario_prices],
        jp("下落幅","Drop"): [f"-${d:.2f}" for d in scenario_drops],
        jp("下落率","Drop%"): [f"{d/listing_price*100:.1f}%" for d in scenario_drops],
        jp("判定","Status"): [
            "✅ 安全" if p>=listing_price*0.9 else
            "⚠️ 注意" if p>=listing_price*0.7 else
            "🔴 危険" if p>=listing_price*0.5 else
            "💀 崩壊" for p in scenario_prices
        ]
    })
    st.dataframe(tbl_s, use_container_width=True, hide_index=True)

    # ── 全株主インパクト一覧 ──
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
# TAB 2: 資金調達シミュレーター
# ════════════════════════════════════════════════════════
with tab2:
    st.subheader(jp("💰 資金調達 Term Sheet シミュレーター","💰 Financing Term Sheet Simulator"))
    fin_price = st.slider(jp("株価 (USD)","Stock Price (USD)"),1.0,25.0,10.0,0.5,format="$%.2f",key="fin_price")

    kw18_c=fin_price*0.82; kw18_s=int(KW_AMT/kw18_c); kw18_d=dil(kw18_s)
    kw30_c=fin_price*0.70; kw30_s=int(KW_AMT/kw30_c); kw30_d=dil(kw30_s)
    roth_p=fin_price*0.97; roth_s=int(ROTH_AMT/roth_p)
    roth_cap=int(TOTAL_SHARES*0.1999)*fin_price
    yk_raw=fin_price*0.93; yk_c=max(yk_raw,YK_FLOOR)
    yk_s=int(YK_AMT/yk_c); yk_d=dil(yk_s)
    yk_floor_hit=yk_raw<=YK_FLOOR

    col1,col2,col3=st.columns(3)
    with col1:
        st.error("❌ CANCELLED — Kadenwood")
        st.caption(jp("$5M 転換社債 | 取引実行しない決断済み","$5M Convertible Note | Deal cancelled"))
        st.metric("18% disc 転換価格" if lang=="JP" else "18% disc Conv.", f"${kw18_c:.2f}")
        st.metric(jp("発行株数","Shares"), f"{kw18_s:,}")
        st.metric(jp("希薄化率","Dilution"), f"{kw18_d:.1f}%")
        st.metric("30% disc 転換価格" if lang=="JP" else "30% disc Conv.", f"${kw30_c:.2f}")
        st.metric(jp("発行株数","Shares"), f"{kw30_s:,}")
        st.metric(jp("希薄化率","Dilution"), f"{kw30_d:.1f}%")
        st.error(jp("⛔ 取引実行しない決断済み。参考値のみ。","⛔ Deal cancelled. Reference only."))
    with col2:
        st.warning("🟡 条件変更 — Roth Principal")
        st.caption(jp("$50M CEF | 上場前現金困難 → 上場後に変更","$50M CEF | Pre-listing cash difficult → Post-listing only"))
        st.metric("97%VWAP", f"${roth_p:.2f}")
        st.metric(jp("発行株数/$10M","Shares/$10M"), f"{roth_s:,}")
        st.metric(jp("コスト","Cost"), "~5%")
        st.metric(jp("19.99%キャップ額","19.99% Cap"), f"${roth_cap/1e6:.1f}M")
        st.warning(jp("⚠️ 上場前の現金提供は困難との回答。上場後に資金投入予定。","⚠️ Pre-listing cash not available. Post-listing funding confirmed."))
        st.success(jp("✅ 上場後のCEF提供は継続合意","✅ Post-listing CEF remains agreed"))
    with col3:
        st.warning("🔄 再交渉中 — Yorkville")
        st.caption(jp("$3M プリペイド | Amortisation削除で再交渉中","$3M Pre-Paid | Renegotiating to remove Amortisation"))
        st.metric(jp("転換価格","Conv. Price"), f"${yk_c:.2f}",
            delta="⚠️ Floor!" if yk_floor_hit else None, delta_color="inverse")
        st.metric(jp("発行株数","Shares"), f"{yk_s:,}")
        st.metric(jp("希薄化率","Dilution"), f"{yk_d:.1f}%")
        st.metric(jp("月次償還（削除交渉中）","Monthly Amort. (removal requested)"), "$802,500")
        st.warning(jp("🔄 Amortisation条項削除を要求中。削除されれば条件が大幅改善。","🔄 Requesting removal of Amortisation clause. If removed, terms significantly improve."))

    st.divider()
    # 希薄化グラフ
    px_r=[i*0.5 for i in range(2,51)]
    fig_fin=go.Figure()
    fig_fin.add_trace(go.Scatter(x=px_r,y=[dil(int(KW_AMT/(p*0.82))) for p in px_r],
        name="Kadenwood 18%",line=dict(color="#1D9E75",width=2)))
    fig_fin.add_trace(go.Scatter(x=px_r,y=[dil(int(KW_AMT/(p*0.70))) for p in px_r],
        name="Kadenwood 30%",line=dict(color="#0F6E56",width=2,dash="dash")))
    fig_fin.add_trace(go.Scatter(x=px_r,y=[dil(int(YK_AMT/max(p*0.93,1.0))) for p in px_r],
        name="Yorkville",line=dict(color="#E24B4A",width=2)))
    fig_fin.add_vline(x=fin_price,line_dash="dot",line_color="red",
        annotation_text=f"${fin_price:.1f}",annotation_position="top right")
    fig_fin.add_hrect(y0=0,y1=5,fillcolor="#1D9E75",opacity=0.05,line_width=0)
    fig_fin.add_hrect(y0=5,y1=10,fillcolor="#FFA500",opacity=0.05,line_width=0)
    fig_fin.add_hrect(y0=10,y1=35,fillcolor="#E24B4A",opacity=0.05,line_width=0)
    fig_fin.update_layout(
        xaxis_title="Stock Price (USD)",yaxis_title="Dilution (%)",
        legend=dict(orientation="h",y=1.05,x=0),
        height=300,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=10,t=40,b=30),font=dict(size=11))
    st.plotly_chart(fig_fin, use_container_width=True)

    # Amortisation
    months=list(range(1,13))
    rev_m=2_240_000/12; amort=802_500
    fig_am=go.Figure()
    fig_am.add_trace(go.Scatter(x=months,y=[rev_m*m/1e6 for m in months],
        name=jp("Yorkvilleなし","Without Yorkville"),
        fill="tozeroy",fillcolor="rgba(29,158,117,0.1)",line=dict(color="#1D9E75",width=2)))
    fig_am.add_trace(go.Scatter(x=months,y=[max(0,(rev_m-amort)*m/1e6) for m in months],
        name=jp("Yorkville発動","Yorkville Triggered"),
        fill="tozeroy",fillcolor="rgba(226,75,74,0.1)",line=dict(color="#E24B4A",width=2)))
    fig_am.add_hline(y=0,line_color="black",line_width=1)
    fig_am.update_layout(
        xaxis_title=jp("月","Month"),yaxis_title=jp("累積キャッシュ ($M)","Cumulative Cash ($M)"),
        legend=dict(orientation="h",y=1.05,x=0),
        height=260,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=5,t=40,b=30),font=dict(size=11))
    st.plotly_chart(fig_am, use_container_width=True)
    st.error(jp("$802,500/月×12=$9.63M/年 vs 売上$2.24M/年 → 売上の430%",
                "$802,500/mo×12=$9.63M/yr vs Revenue $2.24M/yr → 430% of revenue"))

# ════════════════════════════════════════════════════════
# TAB 3: 希薄化分析
# ════════════════════════════════════════════════════════
with tab3:
    st.subheader(jp("📊 希薄化分析","📊 Dilution Analysis"))
    px2=st.slider(jp("株価","Stock Price"),1.0,25.0,10.0,0.5,format="$%.2f",key="px2")
    kw18_d2=dil(int(KW_AMT/(px2*0.82))); kw30_d2=dil(int(KW_AMT/(px2*0.70)))
    yk_d2=dil(int(YK_AMT/max(px2*0.93,1.0)))
    c1,c2,c3=st.columns(3)
    c1.metric("Kadenwood 18%",f"{kw18_d2:.1f}%")
    c2.metric("Kadenwood 30%",f"{kw30_d2:.1f}%")
    c3.metric("Yorkville",f"{yk_d2:.1f}%",delta_color="inverse")
    px_r2=[i*0.5 for i in range(2,51)]
    fig_dil=go.Figure()
    fig_dil.add_trace(go.Scatter(x=px_r2,y=[dil(int(KW_AMT/(p*0.82))) for p in px_r2],
        name="Kadenwood 18%",line=dict(color="#1D9E75",width=2)))
    fig_dil.add_trace(go.Scatter(x=px_r2,y=[dil(int(KW_AMT/(p*0.70))) for p in px_r2],
        name="Kadenwood 30%",line=dict(color="#0F6E56",width=2,dash="dash")))
    fig_dil.add_trace(go.Scatter(x=px_r2,y=[dil(int(YK_AMT/max(p*0.93,1.0))) for p in px_r2],
        name="Yorkville",line=dict(color="#E24B4A",width=2)))
    fig_dil.add_vline(x=px2,line_dash="dot",line_color="red",
        annotation_text=f"${px2:.1f}",annotation_position="top right")
    fig_dil.update_layout(
        xaxis_title="Stock Price (USD)",yaxis_title="Dilution (%)",
        legend=dict(orientation="h",y=1.05,x=0),
        height=320,plot_bgcolor="white",paper_bgcolor="white",
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
    fig_sc.update_layout(
        yaxis_title=jp("時価総額 ($M)","Market Cap ($M)"),
        legend=dict(orientation="h",y=1.05,x=0),
        height=320,plot_bgcolor="white",paper_bgcolor="white",
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
    risks=jp(["Yorkville\n署名","SPAC\n希薄化","株価\n低迷","Kadenwood\n締切","競合\n参入","規制\n変更","上場当日\n売却圧力"],
             ["Yorkville\nSigning","SPAC\nDilution","Stock\nDecline","Kadenwood\nDeadline","Competition","Regulation","Day-1\nSell Pressure"])
    prob=[0.9,0.5,0.4,0.8,0.3,0.4,0.7]; impact=[0.95,0.6,0.7,0.7,0.5,0.6,0.8]
    colors_r=["#E24B4A","#F97316","#F97316","#E24B4A","#FCD34D","#FCD34D","#E24B4A"]
    fig_risk=go.Figure()
    fig_risk.add_trace(go.Scatter(x=prob,y=impact,mode="markers+text",text=risks,
        textposition="top center",marker=dict(size=18,color=colors_r,opacity=0.85)))
    fig_risk.add_vline(x=0.5,line_dash="dot",line_color="gray")
    fig_risk.add_hline(y=0.5,line_dash="dot",line_color="gray")
    fig_risk.update_layout(
        xaxis=dict(title="Probability",range=[0,1.1],tickformat=".0%"),
        yaxis=dict(title="Impact",range=[0,1.1],tickformat=".0%"),
        height=320,plot_bgcolor="#FAFAFA",paper_bgcolor="white",
        margin=dict(l=5,r=5,t=10,b=30),font=dict(size=10),showlegend=False)
    st.plotly_chart(fig_risk, use_container_width=True)

# ════════════════════════════════════════════════════════
# TAB 6: 意思決定
# ════════════════════════════════════════════════════════
with tab6:
    st.subheader(jp("🎯 経営判断サマリー（最新）","🎯 Management Decision Summary (Latest)"))

    # ステータスバッジ
    st.markdown(f"**{jp('📋 各社 最新ステータス','📋 Latest Status per Party')}**")
    s1,s2,s3 = st.columns(3)
    with s1:
        st.error(jp("❌ Kadenwood\n取引実行しない決断済み","❌ Kadenwood\nDeal cancelled"))
    with s2:
        st.warning(jp("🟡 Roth\n上場後に資金投入予定","🟡 Roth\nPost-listing funding confirmed"))
    with s3:
        st.warning(jp("🔄 Yorkville\nAmortisation削除で再交渉中","🔄 Yorkville\nRenegotiating Amortisation removal"))

    st.markdown("---")
    decisions=[
        ("🔴",jp("上場当日の売却圧力対策 — Sponsor・New Publicへのロックアップ交渉を急ぐ",
                  "Urgently negotiate lockup with Sponsor & New Public to prevent Day-1 collapse")),
        ("🔴",jp("上場前の資金調達手段がゼロ — 代替調達手段を至急検討（ブリッジローン・戦略的投資家等）",
                  "Zero pre-listing funding — urgently explore alternatives (bridge loan, strategic investor)")),
        ("🟢",jp("Roth CEF — 上場後の資金調達として継続推進。上場10営業日以内にS-1提出準備",
                  "Roth CEF — continue as post-listing financing. Prepare S-1 within 10 business days of listing")),
        ("🟡",jp("Yorkville — Amortisation削除が実現すれば条件が大幅改善。削除確認後に最終判断",
                  "Yorkville — if Amortisation removed, terms significantly improve. Final decision after confirmation")),
        ("🔴",jp("Yorkville — Amortisation削除なしでの署名は依然として会社存続リスク。絶対に署名禁止",
                  "Yorkville — signing without Amortisation removal remains existential risk. Do NOT sign")),
        ("🔵",jp("トークンレイズを並行トラックで推進 — 上場前の株式希薄化なし補完調達",
                  "Pursue token raise in parallel — zero dilution pre-listing supplementary capital")),
    ]
    for icon,text in decisions:
        if icon=="🔴": st.error(f"{icon} {text}")
        elif icon=="🟢": st.success(f"{icon} {text}")
        elif icon=="🟡": st.warning(f"{icon} {text}")
        else: st.info(f"{icon} {text}")

    st.markdown("---")
    tl={
        jp("🚨 今すぐ（最優先）","🚨 Now (Top Priority)"):[
            jp("上場前ブリッジ資金の代替調達手段を緊急検討（Kadenwood撤退により空白発生）",
               "Urgently explore alternative pre-listing bridge funding (gap created by Kadenwood cancellation)"),
            jp("Yorkville：Amortisation削除の回答期限を設定して交渉を加速",
               "Yorkville: Set deadline for Amortisation removal response and accelerate negotiation"),
            jp("Sponsor・New Publicへのロックアップ交渉を開始",
               "Begin lockup negotiation with Sponsor & New Public"),
        ],
        jp("📅 上場前","📅 Pre-Listing"):[
            jp("Roth CEF契約の最終確認（上場後CEF開始の条件整理）",
               "Finalize Roth CEF terms for post-listing activation"),
            jp("Yorkville：Amortisation削除確認後に最終判断",
               "Yorkville: Final decision after Amortisation removal confirmed"),
            jp("トークンレイズのロードマップ策定・法務確認",
               "Token raise roadmap and legal review"),
        ],
        jp("📅 NASDAQ上場","📅 NASDAQ Listing"):[
            jp("上場当日の売却圧力モニタリング体制を整備",
               "Set up Day-1 sell pressure monitoring"),
            jp("NASDAQ上場承認・取引開始","NASDAQ listing approval and trading begins"),
        ],
        jp("📅 上場後","📅 Post-Listing"):[
            jp("Roth CEF開始 — S-1提出（上場後10営業日以内）",
               "Roth CEF commences — S-1 filed within 10 business days"),
            jp("Yorkville（条件改善済みの場合）署名・実行",
               "Yorkville signing and execution (if terms improved)"),
            jp("トークンレイズ開始","Token raise launch"),
        ],
    }
    for phase,actions in tl.items():
        with st.expander(phase, expanded=("今すぐ" in phase or "Now" in phase)):
            for a in actions: st.markdown(f"- {a}")



# ════════════════════════════════════════════════════════
# SIDEBAR: 株価モニター + AI参謀チーム（常時表示）
# ════════════════════════════════════════════════════════
with st.sidebar:

    # ── 競合・業界株価モニター ──
    st.markdown(f"## 📈 {jp('株価モニター','Stock Monitor')}")

    # 競合・業界銘柄リスト
    WATCHLIST = {
        jp("🏢 自社（SPAC）","🏢 Own (SPAC)"): [
            ("ACQC", "Relativity / BIOT (OTC)"),
        ],
        jp("💉 幹細胞・再生医療","💉 Stem Cell / Regen."): [
            ("MESO",  "Mesoblast"),
            ("ILIU",  "iLius / Lineage Cell"),
            ("PLU",   "Pluri Inc."),
            ("FATE",  "Fate Therapeutics"),
            ("KRTX",  "Karuna / Cell Therapy"),
        ],
        jp("💄 化粧品・美容医療","💄 Cosmetics / Aesthetics"): [
            ("ELF",   "e.l.f. Beauty"),
            ("SKIN",  "The Beauty Health (Hydrafacial)"),
            ("AEYE",  "AudioEye / MedSpa Tech"),
            ("ISRG",  "Intuitive Surgical"),
        ],
        jp("🧬 バイオ・医薬品","🧬 Biopharma"): [
            ("AMGN",  "Amgen"),
            ("REGN",  "Regeneron"),
            ("VRTX",  "Vertex Pharma"),
        ],
        jp("📊 業界ETF","📊 Sector ETFs"): [
            ("IBB",   "iShares Biotech ETF"),
            ("XBI",   "SPDR Biotech ETF"),
            ("ARKG",  "ARK Genomics ETF"),
        ],
    }

    def fetch_price(sym):
        """yfinanceで株価取得。失敗時はNoneを返す"""
        try:
            t    = yf.Ticker(sym)
            hist = t.history(period="2d")
            if hist.empty or len(hist) < 1:
                return None
            cur  = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else cur
            chg  = cur - prev
            pct  = chg / prev * 100 if prev else 0
            return {"price": cur, "change": chg, "pct": pct}
        except:
            return None

    # ── 自社株価（常時固定表示）──
    st.caption(jp("15分遅延 | yfinance","15-min delay | yfinance"))
    acqc = fetch_price("ACQC")
    if acqc:
        clr_a   = "#1D9E75" if acqc["change"] >= 0 else "#E24B4A"
        arrow_a = "▲" if acqc["change"] >= 0 else "▼"
        listing_sim = st.session_state.get("listing_price_val", 10.0)
        gap     = listing_sim - acqc["price"]
        gap_pct = gap / acqc["price"] * 100
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

    # ── 業種別カテゴリ（自社除く）──
    industry_cats = {k: v for k, v in WATCHLIST.items() if "自社" not in k and "Own" not in k}
    selected_cat = st.selectbox(
        jp("📂 業種カテゴリ","📂 Sector Category"),
        list(industry_cats.keys()),
        key="watch_cat"
    )

    # 選択カテゴリの銘柄を表示
    for sym, name in industry_cats[selected_cat]:
        data = fetch_price(sym)
        if data:
            clr   = "#1D9E75" if data["change"] >= 0 else "#E24B4A"
            arrow = "▲" if data["change"] >= 0 else "▼"
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
    st.caption(jp("Dify連携 | シミュレーター数値を自動送信",
                  "Dify Integration | Auto-sends simulator data"))
    st.divider()

    keys_ok = {role: bool(key) for role, key in DIFY_KEYS.items()}

    advisor_labels = {
        "統括参謀": jp("🧠 統括参謀","🧠 Chief Advisor"),
        "CFO参謀":  jp("💼 CFO参謀", "💼 CFO Advisor"),
        "情報参謀": jp("🔍 情報参謀","🔍 Intel Advisor"),
    }

    selected_role = st.radio(
        jp("参謀を選択","Select Advisor"),
        list(DIFY_KEYS.keys()),
        format_func=lambda r: advisor_labels[r],
        key="advisor_select"
    )
    api_key    = DIFY_KEYS[selected_role]
    key_status = "✅ 接続済" if keys_ok[selected_role] else "❌ 未設定"
    st.caption(f"{advisor_labels[selected_role]}　{key_status}")
    st.divider()

    def build_context():
        try:
            lp  = st.session_state.get("listing_price_val", 10.0)
            sp  = st.session_state.get("sell_pct_float_val", 0.0)
            ep  = st.session_state.get("est_price_val", 10.0)
            kw_d= st.session_state.get("kw18_dil_val", 0.0)
            yk_d= st.session_state.get("yk_dil_val", 0.0)
            return jp(f"""【BIOTシミュレーター現在値】
上場基準価格:${lp:.2f} / 売却圧力:{sp:.1f}% / 推定終値:${ep:.2f}
Kadenwood希薄化:{kw_d:.1f}% / Yorkville希薄化:{yk_d:.1f}%
発行済:31,225,944株 / 流通株:18,882,313株
Kadenwood $5M:GO / Roth $50M CEF:GO / Yorkville:NO GO""",
f"""[BIOT Simulator Values]
Listing:${lp:.2f} / Sell Pressure:{sp:.1f}% / Est.Price:${ep:.2f}
Kadenwood Dil:{kw_d:.1f}% / Yorkville Dil:{yk_d:.1f}%
Total:31,225,944 / Float:18,882,313
Kadenwood $5M:GO / Roth $50M CEF:GO / Yorkville:NO GO""")
        except:
            return ""

    # クイック質問
    st.markdown(f"**{jp('クイック質問','Quick Questions')}**")
    quick_jp = {
        "統括参謀": ["今すぐ打つべき最優先の経営判断を教えて","CHARDANとSponsorが全株売った場合のリスクと対策","NASDAQ上場後の株価防衛戦略を立案して"],
        "CFO参謀":  ["Kadenwood・Roth・Yorkvilleの最適スタックを提案","Yorkville署名時のキャッシュフロー影響を数字で","Roth CEF引出タイミングの最適戦略を教えて"],
        "情報参謀": ["SPAC上場当日の売却圧力の最新市場動向を教えて","上場当日に株価が崩壊したSPAC事例を調べて","CHARDANのSPAC案件での過去の行動パターンを調査"],
    }
    quick_en = {
        "統括参謀": ["Top management decision I should make right now?","Risk scenario if CHARDAN and Sponsor sell all shares","Develop a post-listing stock price defense strategy"],
        "CFO参謀":  ["Propose optimal financing stack among 3 parties","Cash flow impact if Yorkville is signed","Optimal timing strategy for Roth CEF draws"],
        "情報参謀": ["Latest market trends on SPAC Day-1 sell pressure","SPAC listings where stock collapsed on Day-1","CHARDAN's past behavior patterns in SPAC deals"],
    }
    quick_questions = quick_jp[selected_role] if lang=="JP" else quick_en[selected_role]
    quick_input = None
    for i, q in enumerate(quick_questions):
        if st.button(f"Q{i+1} {q[:20]}…" if len(q)>20 else f"Q{i+1} {q}",
                     key=f"qk_{selected_role}_{i}", use_container_width=True):
            quick_input = q

    st.divider()

    # チャット履歴
    chat_history = st.session_state[f"chat_{selected_role}"]
    for msg in chat_history[-6:]:  # 直近6件を表示
        with st.chat_message(msg["role"], avatar="👔" if msg["role"]=="user" else "🤖"):
            st.markdown(msg["content"])

    # 入力欄
    user_input = st.chat_input(
        jp(f"{selected_role}に質問…", f"Ask {selected_role}…"),
        key=f"sb_input_{selected_role}"
    )
    if quick_input:
        user_input = quick_input

    if user_input:
        if not api_key:
            st.error(jp("⚠️ APIキー未設定","⚠️ API key not set"))
        else:
            context      = build_context()
            full_message = f"{context}\n\n{jp('BOSSからの質問：','BOSS: ')}{user_input}" if context else user_input
            chat_history.append({"role": "user", "content": user_input})
            with st.chat_message("user", avatar="👔"):
                st.markdown(user_input)
            with st.chat_message("assistant", avatar="🤖"):
                with st.spinner(jp("分析中…","Analyzing…")):
                    conv_id = st.session_state[f"conv_id_{selected_role}"]
                    result  = call_dify(api_key, full_message, conv_id)
                if result["ok"]:
                    st.markdown(result["answer"])
                    chat_history.append({"role": "assistant", "content": result["answer"]})
                    st.session_state[f"conv_id_{selected_role}"] = result["conv_id"]
                else:
                    st.error(result["answer"])
            st.session_state[f"chat_{selected_role}"] = chat_history
            st.rerun()

    if chat_history:
        if st.button(jp("🔄 会話リセット","🔄 Reset"), key=f"sb_reset_{selected_role}", use_container_width=True):
            st.session_state[f"chat_{selected_role}"] = []
            st.session_state[f"conv_id_{selected_role}"] = ""
            st.rerun()

st.divider()
st.caption(jp("Instinct Brothers Holdings | 統合資本管理シミュレーター | 社外秘 | May 2026",
              "Instinct Brothers Holdings | Integrated Capital Simulator | Confidential | May 2026"))
