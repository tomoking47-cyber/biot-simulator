import streamlit as st
import plotly.graph_objects as go
import pandas as pd
from datetime import date

st.set_page_config(page_title="BIOT Capital Simulator", page_icon="📊", layout="centered")
st.markdown("""
<style>
html,body,[class*="css"]{font-size:clamp(12px,2.5vw,15px)!important}
[data-testid="stMetricLabel"]{font-size:clamp(10px,1.8vw,12px)!important;white-space:normal!important;word-break:break-word!important}
[data-testid="stMetricValue"]{font-size:clamp(13px,2.8vw,20px)!important}
[data-testid="column"]{padding:0 3px!important}
p,div,span,label{word-break:break-word!important;overflow-wrap:break-word!important}
h1{font-size:clamp(16px,3.5vw,24px)!important}
h2{font-size:clamp(14px,2.8vw,20px)!important}
h3{font-size:clamp(12px,2.2vw,16px)!important}
[data-testid="stButton"] button{font-size:clamp(11px,1.8vw,13px)!important}
[data-testid="stAlert"]{font-size:clamp(11px,1.8vw,13px)!important;padding:6px 10px!important}
[data-testid="stTabs"] button{font-size:clamp(10px,1.6vw,12px)!important;padding:3px 5px!important}
</style>
""", unsafe_allow_html=True)

# ── 認証 ──
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

# ── ヘッダー ──
col_h, col_l = st.columns([5,1])
with col_l:
    if st.button("🇺🇸 EN" if lang=="JP" else "🇯🇵 JP"):
        st.session_state.lang = "EN" if lang=="JP" else "JP"
        st.rerun()
with col_h:
    st.title(f"📊 {jp('BIOT 統合資本管理シミュレーター','BIOT Integrated Capital Simulator')}")
st.caption(jp("Instinct Brothers Holdings | 発行済株数 31,225,944株 | 社外秘",
              "Instinct Brothers Holdings | 31,225,944 shares outstanding | CONFIDENTIAL"))

days_left = (date(2026,6,2) - date.today()).days
st.metric("⏰ Kadenwood Deadline", f"{days_left} {'日' if lang=='JP' else 'days'}", delta="URGENT", delta_color="inverse")
st.divider()

# ════════════════════════════════
# 定数
# ════════════════════════════════
TOTAL_SHARES  = 31_225_944
FLOAT_SHARES  = 18_882_313   # ロックアップなし合計
KW_AMT        = 5_000_000
ROTH_AMT      = 10_000_000   # 1回引出額
ROTH_MAX      = 50_000_000
YK_AMT        = 3_000_000
YK_FLOOR      = 1.00
SENSITIVITY   = 1.5           # 売却圧力感応度（1%売圧→1.5%下落）

def dil(new_s, base=TOTAL_SHARES):
    return new_s / (base + new_s) * 100

# Cap Table
SHAREHOLDERS = [
    # name_jp, name_en, shares, lockup_months, cost, can_sell
    ("Nagano Tomoki",          "Nagano Tomoki",           12_079_500, 12,   None,  False),
    ("New Public",             "New Public Stockholders",  9_970_500,  0,  10.00,  True),
    ("Public Stockholders",    "Public Stockholders",         43_742,  0,  10.00,  True),
    ("Initial Stockholders",   "Initial Stockholders",       738_369,  0,  10.00,  True),
    ("Sponsor (Relativity)",   "Sponsor (Relativity)",     5_515_481,  0,   None,  True),
    ("Everise Concepts",       "Everise Concepts",            450_000, 12,   None,  False),
    ("CHARDAN",                "CHARDAN",                  1_615_385,  0,   3.25,  True),
    ("TN NOMURA",              "TN NOMURA",                   19_316,  0,   3.25,  True),
    ("Kadenwood",              "Kadenwood",                  793_651,  6,   6.30,  False),
]
sellable = [(r[0],r[1],r[2],r[4]) for r in SHAREHOLDERS if r[5]]
locked   = [(r[0],r[1],r[2],r[3]) for r in SHAREHOLDERS if not r[5]]

# ════════════════════════════════
# タブ
# ════════════════════════════════
tab1,tab2,tab3,tab4,tab5,tab6 = st.tabs([
    jp("🏦 上場当日売却圧力","🏦 Day-1 Sell Pressure"),
    jp("💰 資金調達シミュ","💰 Financing Sim"),
    jp("📊 希薄化分析","📊 Dilution"),
    jp("📈 シナリオ予測","📈 Scenarios"),
    jp("⚠️ リスク分析","⚠️ Risk"),
    jp("🎯 意思決定","🎯 Decision"),
])

# ════════════════════════════════════════════════════════
# TAB 1: 上場当日 売却圧力シミュレーター
# ════════════════════════════════════════════════════════
with tab1:
    st.subheader(jp("🏦 上場当日 売却圧力シミュレーター","🏦 Day-1 Sell Pressure Simulator"))
    st.caption(jp(
        "ロックアップなし株主が上場当日に一斉売却した場合、BIOT株価にどれだけ影響が出るかをシミュレーションします。",
        "Simulates stock price impact when lock-up-free shareholders sell on NASDAQ listing day."
    ))

    listing_price = st.slider(
        jp("上場基準価格 (USD)","Listing Base Price (USD)"),
        min_value=5.0, max_value=20.0, value=10.0, step=0.5, format="$%.2f"
    )
    st.markdown("---")
    st.markdown(f"### {jp('株主別 売却設定','Per-Shareholder Sell Settings')}")

    sell_data = []
    RISK_COLOR = {
        "CHARDAN":"🔴","Sponsor (Relativity)":"🔴","New Public":"🟠",
        "Initial Stockholders":"🟡","Public Stockholders":"🟡","TN NOMURA":"🟢",
    }
    for n_jp,n_en,max_sh,cost in sellable:
        name = jp(n_jp,n_en)
        icon = RISK_COLOR.get(n_jp,"🟡")
        with st.expander(f"{icon} {name}　{max_sh:,} {jp('株','shares')}", expanded=(n_jp=="CHARDAN")):
            ca,cb = st.columns(2)
            with ca:
                sold = st.slider(jp("売却株数","Shares Sold"),
                    0, max_sh, 0, max(1000, max_sh//100), key=f"s_{n_jp}", format="%d")
            with cb:
                sp = st.slider(jp("売却単価","Sell Price"),
                    0.10, 20.0, float(listing_price), 0.10, key=f"p_{n_jp}", format="$%.2f")
            proceeds = sold * sp
            pnl = (sp - cost)*sold if cost and sold>0 else None
            c1,c2,c3 = st.columns(3)
            c1.metric(jp("売却株数","Sold"), f"{sold:,}")
            c2.metric(jp("売却収益","Proceeds"), f"${proceeds:,.0f}")
            if pnl is not None:
                c3.metric(jp("損益","P&L"), f"${pnl:+,.0f}",
                    f"{((sp-cost)/cost*100):+.1f}%" if cost else "",
                    delta_color="normal" if pnl>=0 else "inverse")
            else:
                c3.metric(jp("取得単価","Cost"), f"${cost:.2f}" if cost else "N/A")
            sell_data.append(dict(name=name,n_jp=n_jp,max_shares=max_sh,
                sold=sold,sp=sp,cost=cost,proceeds=proceeds,pnl=pnl))

    st.markdown("---")
    total_sold     = sum(d["sold"] for d in sell_data)
    total_proceeds = sum(d["proceeds"] for d in sell_data)
    sell_pct_float = total_sold/FLOAT_SHARES*100 if FLOAT_SHARES>0 else 0
    sell_pct_total = total_sold/TOTAL_SHARES*100
    price_drop_pct = sell_pct_float * SENSITIVITY
    est_price      = max(0.10, listing_price*(1-price_drop_pct/100))
    price_drop_abs = listing_price - est_price

    st.subheader(jp("📊 総合インパクト","📊 Total Impact"))
    k1,k2,k3,k4 = st.columns(4)
    k1.metric(jp("総売却株数","Total Sold"),   f"{total_sold:,}", f"{sell_pct_total:.1f}%")
    k2.metric(jp("売却圧力","Sell Pressure"), f"{sell_pct_float:.1f}%", jp("対流通株","vs Float"))
    k3.metric(jp("推定株価","Est. Price"),    f"${est_price:.2f}", f"-${price_drop_abs:.2f}", delta_color="inverse")
    k4.metric(jp("総売却収益","Total Proceeds"),f"${total_proceeds:,.0f}")

    if   sell_pct_float>=30: st.error(jp("🚨 売却圧力30%超 — 上場当日の株価崩壊リスクが極めて高い。緊急対策が必要。","🚨 Sell pressure >30% — extreme collapse risk on listing day. Emergency action required."))
    elif sell_pct_float>=15: st.error(jp("⚠️ 売却圧力15%超 — 深刻な下押し圧力。ロックアップ交渉を急ぐこと。","⚠️ Sell pressure >15% — serious downward pressure. Lockup negotiation urgent."))
    elif sell_pct_float>=5:  st.warning(jp("⚠️ 売却圧力5%超 — 株価への影響に注意。","⚠️ Sell pressure >5% — monitor price impact."))
    else:                    st.success(jp("✅ 売却圧力は軽微。市場への影響は限定的。","✅ Sell pressure is minor — limited market impact."))

    # グラフ①：株主別売却内訳
    st.markdown(f"**① {jp('株主別 売却 vs 保有継続','Sold vs Held by Shareholder')}**")
    fig_a = go.Figure()
    fig_a.add_trace(go.Bar(name=jp("売却","Sold"),
        x=[d["name"] for d in sell_data], y=[d["sold"] for d in sell_data], marker_color="#E24B4A"))
    fig_a.add_trace(go.Bar(name=jp("保有継続","Held"),
        x=[d["name"] for d in sell_data], y=[d["max_shares"]-d["sold"] for d in sell_data], marker_color="#1D9E75"))
    fig_a.update_layout(barmode="stack", height=280,
        plot_bgcolor="white", paper_bgcolor="white",
        legend=dict(orientation="h",y=1.05,x=0),
        margin=dict(l=5,r=5,t=40,b=60), font=dict(size=10))
    st.plotly_chart(fig_a, use_container_width=True)

    # グラフ②：売却圧力 → 株価影響ライン
    st.markdown(f"**② {jp('売却圧力と推定株価の関係','Sell Pressure vs Estimated Stock Price')}**")
    pct_range  = [i*0.5 for i in range(0,61)]
    price_line = [max(0.1, listing_price*(1-p*SENSITIVITY/100)) for p in pct_range]
    fig_b = go.Figure()
    fig_b.add_trace(go.Scatter(x=pct_range, y=price_line, mode="lines",
        fill="tozeroy", fillcolor="rgba(226,75,74,0.08)", line=dict(color="#E24B4A",width=2)))
    fig_b.add_vline(x=sell_pct_float, line_dash="dot", line_color="#2563EB",
        annotation_text=f"{sell_pct_float:.1f}% → ${est_price:.2f}", annotation_position="top right")
    fig_b.add_hline(y=3.25, line_dash="dash", line_color="#F97316",
        annotation_text="CHARDAN cost $3.25", annotation_position="right")
    fig_b.update_layout(
        xaxis_title=jp("売却圧力 (%)","Sell Pressure (%)"),
        yaxis_title=jp("推定株価 ($)","Est. Stock Price ($)"),
        height=260, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=60,t=10,b=30), font=dict(size=11), showlegend=False)
    st.plotly_chart(fig_b, use_container_width=True)

    # グラフ③：ドーナツ（株式構成）
    st.markdown(f"**③ {jp('売却後の株式構成','Post-Sale Share Structure')}**")
    locked_total = sum(r[2] for r in locked)
    remain_sellable = FLOAT_SHARES - total_sold
    fig_c = go.Figure(go.Pie(
        labels=[jp("ロックアップ株","Locked"),jp("売却済","Sold"),jp("流通残","Float Remaining")],
        values=[locked_total, total_sold, remain_sellable],
        hole=0.55, marker_colors=["#94A3B8","#E24B4A","#1D9E75"],
        textinfo="label+percent", textfont_size=11,
    ))
    fig_c.update_layout(height=260, margin=dict(l=5,r=5,t=10,b=10), showlegend=False,
        annotations=[dict(text=f"{sell_pct_total:.1f}%<br>Sold", x=0.5,y=0.5, font_size=13, showarrow=False)])
    st.plotly_chart(fig_c, use_container_width=True)

    # 総合インパクト表
    st.markdown(f"**④ {jp('全株主 売却インパクト一覧','Full Shareholder Impact Table')}**")
    rows=[]
    for d in sell_data:
        rows.append({
            jp("株主","Shareholder"): d["name"],
            jp("保有株数","Held"): f"{d['max_shares']:,}",
            jp("売却株数","Sold"): f"{d['sold']:,}",
            jp("売却率","Sell%"): f"{d['sold']/d['max_shares']*100:.1f}%" if d['max_shares']>0 else "0%",
            jp("売却単価","Price"): f"${d['sp']:.2f}",
            jp("売却収益","Proceeds"): f"${d['proceeds']:,.0f}",
            jp("損益","P&L"): f"${d['pnl']:+,.0f}" if d['pnl'] is not None else "N/A",
        })
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
    st.caption(jp(
        f"※ 推定株価モデル：売却圧力1%につき約{SENSITIVITY}%の株価下落を仮定（SPAC上場初日の低流動性を考慮）",
        f"※ Price model: ~{SENSITIVITY}% decline per 1% sell pressure (assumes low liquidity on SPAC listing day)"
    ))

# ════════════════════════════════════════════════════════
# TAB 2: 資金調達シミュレーター（Kadenwood/Roth/Yorkville）
# ════════════════════════════════════════════════════════
with tab2:
    st.subheader(jp("💰 資金調達 Term Sheet シミュレーター","💰 Financing Term Sheet Simulator"))
    st.caption(jp("Kadenwood・Roth・Yorkvilleの条件をリアルタイムで比較します。",
                  "Real-time comparison of Kadenwood, Roth, and Yorkville term sheet conditions."))

    fin_price = st.slider(jp("株価 (USD)","Stock Price (USD)"),
        1.0, 25.0, 10.0, 0.5, format="$%.2f", key="fin_price")

    # 計算
    kw18_c = fin_price*0.82; kw18_s = int(KW_AMT/kw18_c); kw18_d = dil(kw18_s)
    kw30_c = fin_price*0.70; kw30_s = int(KW_AMT/kw30_c); kw30_d = dil(kw30_s)
    roth_p  = fin_price*0.97; roth_s  = int(ROTH_AMT/roth_p)
    roth_cap= int(TOTAL_SHARES*0.1999)*fin_price
    yk_raw  = fin_price*0.93; yk_c = max(yk_raw,YK_FLOOR)
    yk_s    = int(YK_AMT/yk_c); yk_d = dil(yk_s)
    yk_floor_hit = yk_raw <= YK_FLOOR

    # 3社カード
    col1,col2,col3 = st.columns(3)
    with col1:
        st.success(f"✅ GO — Kadenwood")
        st.caption("$5M Convertible Note | Pre-Listing")
        st.metric("18% disc → 転換価格" if lang=="JP" else "18% disc → Conv.Price", f"${kw18_c:.2f}")
        st.metric(jp("発行株数","Shares"), f"{kw18_s:,}")
        st.metric(jp("希薄化率","Dilution"), f"{kw18_d:.1f}%")
        st.markdown("---")
        st.metric("30% disc → 転換価格" if lang=="JP" else "30% disc → Conv.Price", f"${kw30_c:.2f}")
        st.metric(jp("発行株数","Shares"), f"{kw30_s:,}")
        st.metric(jp("希薄化率","Dilution"), f"{kw30_d:.1f}%")
        st.info("Lock-up: 6ヶ月" if lang=="JP" else "Lock-up: 6 months")

    with col2:
        st.success(f"✅ GO — Roth Principal")
        st.caption("$50M CEF | Post-Listing")
        st.metric(jp("取引価格 97%VWAP","Trade Price 97%VWAP"), f"${roth_p:.2f}")
        st.metric(jp("発行株数/$10M","Shares/$10M"), f"{roth_s:,}")
        st.metric(jp("コスト","All-in Cost"), "~5%")
        st.metric(jp("19.99%キャップ到達額","19.99% Cap Amount"), f"${roth_cap/1e6:.1f}M")
        st.success(jp("発行者コントロール：完全","Issuer Control: Full"))

    with col3:
        st.error(f"❌ NO GO — Yorkville")
        st.caption("$3M Pre-Paid | DO NOT SIGN")
        st.metric(jp("転換価格 7%disc","Conv. 7% disc"),
            f"${yk_c:.2f}", delta="⚠️ Floor hit!" if yk_floor_hit else None, delta_color="inverse")
        st.metric(jp("発行株数","Shares"), f"{yk_s:,}")
        st.metric(jp("希薄化率","Dilution"), f"{yk_d:.1f}%")
        st.metric(jp("フロア価格","Floor Price"), "$1.00")
        st.error(jp("月次償還: $802,500\n売上の430%","Monthly amort: $802,500 = 430% of revenue"))

    st.divider()

    # 希薄化率比較グラフ
    st.markdown(f"**{jp('希薄化率 比較（現在株価）','Dilution Comparison at Current Price')}**")
    fig_d = go.Figure(go.Bar(
        x=["Kadenwood 18%","Kadenwood 30%","Yorkville"],
        y=[kw18_d, kw30_d, yk_d],
        marker_color=["#1D9E75","#0F6E56","#E24B4A"],
        text=[f"{v:.1f}%" for v in [kw18_d,kw30_d,yk_d]],
        textposition="outside"
    ))
    fig_d.update_layout(
        yaxis=dict(range=[0,max(kw30_d,yk_d)*1.4], title=jp("希薄化率 (%)","Dilution (%)")),
        height=240, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=5,t=10,b=30), font=dict(size=11))
    st.plotly_chart(fig_d, use_container_width=True)

    # 株価レンジ別 希薄化ライン
    st.markdown(f"**{jp('株価レンジ別 希薄化率推移','Dilution vs Stock Price Range')}**")
    px_range = [i*0.5 for i in range(2,51)]
    fig_e = go.Figure()
    fig_e.add_trace(go.Scatter(x=px_range, y=[dil(int(KW_AMT/(p*0.82))) for p in px_range],
        name="Kadenwood 18%", line=dict(color="#1D9E75",width=2)))
    fig_e.add_trace(go.Scatter(x=px_range, y=[dil(int(KW_AMT/(p*0.70))) for p in px_range],
        name="Kadenwood 30%", line=dict(color="#0F6E56",width=2,dash="dash")))
    fig_e.add_trace(go.Scatter(x=px_range, y=[dil(int(YK_AMT/max(p*0.93,1.0))) for p in px_range],
        name="Yorkville",     line=dict(color="#E24B4A",width=2)))
    fig_e.add_vline(x=fin_price, line_dash="dot", line_color="red",
        annotation_text=f"${fin_price:.1f}", annotation_position="top right")
    fig_e.add_hrect(y0=0,y1=5,  fillcolor="#1D9E75",opacity=0.05,line_width=0)
    fig_e.add_hrect(y0=5,y1=10, fillcolor="#FFA500",opacity=0.05,line_width=0)
    fig_e.add_hrect(y0=10,y1=35,fillcolor="#E24B4A",opacity=0.05,line_width=0)
    fig_e.update_layout(
        xaxis_title="Stock Price (USD)", yaxis_title="Dilution (%)",
        legend=dict(orientation="h",y=1.05,x=0),
        height=300, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=10,t=40,b=30), font=dict(size=11))
    st.plotly_chart(fig_e, use_container_width=True)

    # Yorkvilleリスク：Amortisation
    st.markdown(f"**{jp('⚠️ Yorkville Amortisation Event — キャッシュフロー破綻シミュレーション','⚠️ Yorkville Amortisation Event — Cash Flow Collapse')}**")
    months = list(range(1,13))
    rev_m  = 2_240_000/12
    amort  = 802_500
    cf_ok  = [rev_m*m/1e6 for m in months]
    cf_yk  = [max(0,(rev_m-amort)*m/1e6) for m in months]
    fig_f  = go.Figure()
    fig_f.add_trace(go.Scatter(x=months,y=cf_ok,name=jp("Yorkvilleなし","Without Yorkville"),
        fill="tozeroy",fillcolor="rgba(29,158,117,0.1)",line=dict(color="#1D9E75",width=2)))
    fig_f.add_trace(go.Scatter(x=months,y=cf_yk,name=jp("Yorkville発動","Yorkville Triggered"),
        fill="tozeroy",fillcolor="rgba(226,75,74,0.1)",line=dict(color="#E24B4A",width=2)))
    fig_f.add_hline(y=0,line_color="black",line_width=1)
    fig_f.update_layout(
        xaxis_title=jp("月","Month"), yaxis_title=jp("累積キャッシュ ($M)","Cumulative Cash ($M)"),
        legend=dict(orientation="h",y=1.05,x=0),
        height=260, plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=5,t=40,b=30), font=dict(size=11))
    st.plotly_chart(fig_f, use_container_width=True)
    st.error(jp("$802,500/月 × 12 = $9.63M/年 vs 売上 $2.24M/年 → 売上の430%",
                "$802,500/mo × 12 = $9.63M/yr vs Revenue $2.24M/yr → 430% of annual revenue"))

    # Yorkville VRT損失ウォーターフォール
    st.markdown(f"**{jp('Yorkville署名による機会損失','Opportunity Cost of Signing Yorkville')}**")
    fig_g = go.Figure(go.Waterfall(
        orientation="v",
        measure=["absolute","relative","relative","total"],
        x=["Yorkville Pre-Paid", "Roth CEF Lost", "Token Raise Lost", "Net"],
        y=[3,-50,-50,0],
        text=["$3M","−$50M","−$50M","Net −$97M"],
        textposition="outside",
        connector={"line":{"color":"gray"}},
        increasing={"marker":{"color":"#1D9E75"}},
        decreasing={"marker":{"color":"#E24B4A"}},
        totals={"marker":{"color":"#1E40AF"}},
    ))
    fig_g.update_layout(
        yaxis_title="USD Million", height=260,
        plot_bgcolor="white", paper_bgcolor="white",
        margin=dict(l=5,r=5,t=10,b=10), font=dict(size=11))
    st.plotly_chart(fig_g, use_container_width=True)

# ════════════════════════════════════════════════════════
# TAB 3: 希薄化分析
# ════════════════════════════════════════════════════════
with tab3:
    st.subheader(jp("📊 希薄化分析","📊 Dilution Analysis"))
    px2 = st.slider(jp("株価","Stock Price"),1.0,25.0,10.0,0.5,format="$%.2f",key="px2")
    kw18_d2 = dil(int(KW_AMT/(px2*0.82)))
    kw30_d2 = dil(int(KW_AMT/(px2*0.70)))
    yk_d2   = dil(int(YK_AMT/max(px2*0.93,1.0)))

    if px2<2:   st.error(jp("⚠️ 深刻ゾーン：株主価値が大幅毀損。Yorkvilleは絶対回避。","⚠️ Critical: severe value destruction. Avoid Yorkville absolutely."))
    elif px2<=5:st.warning(jp("⚠️ 注意ゾーン：希薄化率が上昇中。","⚠️ Caution: dilution rising."))
    elif px2>=15:st.success(jp("✅ 良好ゾーン：希薄化率が低水準。","✅ Strong: low dilution across instruments."))
    else:       st.info(jp("✅ 標準ゾーン（$10付近）：Kadenwood+Rothが最適解。","✅ Base zone (~$10): Kadenwood+Roth optimal."))

    c1,c2,c3=st.columns(3)
    c1.metric("Kadenwood 18%",f"{kw18_d2:.1f}%",f"{int(KW_AMT/(px2*0.82)):,} shares")
    c2.metric("Kadenwood 30%",f"{kw30_d2:.1f}%",f"{int(KW_AMT/(px2*0.70)):,} shares")
    c3.metric("Yorkville",    f"{yk_d2:.1f}%",  f"{int(YK_AMT/max(px2*0.93,1.0)):,} shares", delta_color="inverse")

    px_r=[i*0.5 for i in range(2,51)]
    fig_h=go.Figure()
    fig_h.add_trace(go.Scatter(x=px_r,y=[dil(int(KW_AMT/(p*0.82))) for p in px_r],
        name="Kadenwood 18%",line=dict(color="#1D9E75",width=2)))
    fig_h.add_trace(go.Scatter(x=px_r,y=[dil(int(KW_AMT/(p*0.70))) for p in px_r],
        name="Kadenwood 30%",line=dict(color="#0F6E56",width=2,dash="dash")))
    fig_h.add_trace(go.Scatter(x=px_r,y=[dil(int(YK_AMT/max(p*0.93,1.0))) for p in px_r],
        name="Yorkville",line=dict(color="#E24B4A",width=2)))
    fig_h.add_vline(x=px2,line_dash="dot",line_color="red",
        annotation_text=f"${px2:.1f}",annotation_position="top right")
    fig_h.add_hrect(y0=0,y1=5,fillcolor="#1D9E75",opacity=0.05,line_width=0)
    fig_h.add_hrect(y0=5,y1=10,fillcolor="#FFA500",opacity=0.05,line_width=0)
    fig_h.add_hrect(y0=10,y1=35,fillcolor="#E24B4A",opacity=0.05,line_width=0)
    fig_h.update_layout(
        xaxis_title="Stock Price (USD)",yaxis_title="Dilution (%)",
        legend=dict(orientation="h",y=1.05,x=0),
        height=320,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=10,t=40,b=30),font=dict(size=11))
    st.plotly_chart(fig_h, use_container_width=True)

# ════════════════════════════════════════════════════════
# TAB 4: シナリオ予測
# ════════════════════════════════════════════════════════
with tab4:
    st.subheader(jp("📈 時価総額シナリオ予測（上場〜5年後）","📈 Market Cap Forecast (Listing → Y+5)"))
    labels_y=["Listing","Y+1","Y+2","Y+3","Y+4","Y+5"]
    bear=[150,50,80,120,180,250]
    base=[150,200,500,800,1200,2000]
    bull=[150,500,1000,2000,3000,4000]

    fig_i=go.Figure()
    fig_i.add_trace(go.Scatter(x=labels_y,y=bear,name=jp("🔴 弱気","🔴 Bear"),
        line=dict(color="#E24B4A",width=2,dash="dash")))
    fig_i.add_trace(go.Scatter(x=labels_y,y=base,name=jp("🟢 標準","🟢 Base"),
        line=dict(color="#1D9E75",width=3),fill="tonexty",fillcolor="rgba(29,158,117,0.06)"))
    fig_i.add_trace(go.Scatter(x=labels_y,y=bull,name=jp("🔵 強気","🔵 Bull"),
        line=dict(color="#2563EB",width=2,dash="dot"),fill="tonexty",fillcolor="rgba(37,99,235,0.05)"))
    fig_i.add_hline(y=1000,line_dash="dot",line_color="gray",annotation_text="$1B",annotation_position="right")
    fig_i.add_hline(y=4000,line_dash="dot",line_color="#7C3AED",annotation_text="$4B",annotation_position="right")
    fig_i.update_layout(
        yaxis_title=jp("時価総額 ($M)","Market Cap ($M)"),
        legend=dict(orientation="h",y=1.05,x=0),
        height=320,plot_bgcolor="white",paper_bgcolor="white",
        margin=dict(l=5,r=60,t=40,b=20),font=dict(size=11))
    st.plotly_chart(fig_i, use_container_width=True)

    tbl=pd.DataFrame({
        jp("年","Year"):labels_y,
        jp("🔴 弱気","🔴 Bear"):["$150M","$50M","$80M","$120M","$180M","$250M"],
        jp("🟢 標準","🟢 Base"):["$150M","$200M","$500M","$800M","$1.2B","$2B"],
        jp("🔵 強気","🔵 Bull"):["$150M","$500M","$1B","$2B","$3B","$4B"],
    })
    st.dataframe(tbl, use_container_width=True, hide_index=True)
    if lang=="JP":
        st.markdown("**前提**\n- 🔴 弱気：Yorkville署名・株価低迷・SPAC希薄化で株主離脱\n- 🟢 標準：Kadenwood+Roth実行・Q3/Q4でRWA・BioTrace本番稼働\n- 🔵 強気：トークンレイズ成功・地域銀行買収・F1/FQプロジェクト商業化")
    else:
        st.markdown("**Assumptions**\n- 🔴 Bear: Yorkville signed, stock decline, shareholder exit\n- 🟢 Base: Kadenwood+Roth executed, RWA & BioTrace live Q3/Q4\n- 🔵 Bull: Token raise success, bank acquisition, F1/FQ commercialization")

# ════════════════════════════════════════════════════════
# TAB 5: リスク分析
# ════════════════════════════════════════════════════════
with tab5:
    st.subheader(jp("⚠️ リスクマトリクス","⚠️ Risk Matrix"))
    risks_jp=["Yorkville\n署名","SPAC\n希薄化","株価\n低迷","Kadenwood\n締切超過","競合\n参入","規制\n変更","上場当日\n売却圧力"]
    risks_en=["Yorkville\nSigning","SPAC\nDilution","Stock\nDecline","Kadenwood\nDeadline","Competition","Regulation","Day-1\nSell Pressure"]
    risks=risks_jp if lang=="JP" else risks_en
    prob  =[0.9,0.5,0.4,0.8,0.3,0.4,0.7]
    impact=[0.95,0.6,0.7,0.7,0.5,0.6,0.8]
    colors=["#E24B4A","#F97316","#F97316","#E24B4A","#FCD34D","#FCD34D","#E24B4A"]
    fig_j=go.Figure()
    fig_j.add_trace(go.Scatter(x=prob,y=impact,mode="markers+text",text=risks,
        textposition="top center",marker=dict(size=18,color=colors,opacity=0.85)))
    fig_j.add_vline(x=0.5,line_dash="dot",line_color="gray")
    fig_j.add_hline(y=0.5,line_dash="dot",line_color="gray")
    fig_j.update_layout(
        xaxis=dict(title="Probability",range=[0,1.1],tickformat=".0%"),
        yaxis=dict(title="Impact",range=[0,1.1],tickformat=".0%"),
        height=320,plot_bgcolor="#FAFAFA",paper_bgcolor="white",
        margin=dict(l=5,r=5,t=10,b=30),font=dict(size=10),showlegend=False)
    st.plotly_chart(fig_j, use_container_width=True)

# ════════════════════════════════════════════════════════
# TAB 6: 意思決定
# ════════════════════════════════════════════════════════
with tab6:
    st.subheader(jp("🎯 経営判断サマリー","🎯 Management Decision Summary"))
    decisions=[
        ("🔴",jp("Yorkville署名禁止 — 現状条件は会社存続リスク","Do NOT sign Yorkville — existential risk under current terms")),
        ("🟢",jp("Kadenwood最優先 — 今週中にエンゲージメントレター署名","Prioritize Kadenwood — sign engagement letter this week")),
        ("🟢",jp("Roth CEF並行開始 — 上場後10営業日以内にS-1提出","Initiate Roth CEF in parallel — S-1 within 10 business days")),
        ("🟡",jp("Yorkville再交渉は上場後 — プリペイド削除・Roth除外が条件","Renegotiate Yorkville post-listing — remove Pre-Paid, add Roth carve-out")),
        ("🔵",jp("トークンレイズ並行検討 — 株式希薄化ゼロの補完調達","Pursue token raise in parallel — zero equity dilution")),
        ("🔴",jp("上場当日の売却圧力対策 — Sponsor・New Publicへのロックアップ交渉を急ぐ","Day-1 sell pressure mitigation — urgently negotiate lockup with Sponsor & New Public")),
    ]
    for icon,text in decisions:
        if icon=="🔴": st.error(f"{icon} {text}")
        elif icon=="🟢": st.success(f"{icon} {text}")
        elif icon=="🟡": st.warning(f"{icon} {text}")
        else: st.info(f"{icon} {text}")

    st.markdown("---")
    st.markdown(f"**{jp('タイムライン','Timeline')}**")
    tl_data={
        jp("🚨 今すぐ（今週）","🚨 Now (This Week)"):[
            jp("Kadenwoodエンゲージメントレター署名（期限超過・即時対応）","Sign Kadenwood engagement letter (MISSED — act immediately)"),
            jp("Yorkville再交渉通知（プリペイド削除・Roth VRT除外が条件）","Notify Yorkville of renegotiation conditions"),
            jp("Sponsor・New Publicへのロックアップ交渉開始","Begin lockup negotiation with Sponsor & New Public"),
        ],
        jp("📅 5月中","📅 May"):[
            jp("Kadenwood最終条件確定","Finalize Kadenwood terms"),
            jp("Roth CEF署名","Sign Roth CEF"),
            jp("トークンレイズロードマップ策定","Develop token raise roadmap"),
        ],
        jp("📅 6月","📅 June"):[
            jp("Kadenwood $5Mクローズ（6月2日目標）","Kadenwood $5M close (target: June 2)"),
            jp("NASDAQ上場承認","NASDAQ listing approval"),
        ],
        jp("📅 上場後","📅 Post-Listing"):[
            jp("Roth CEF開始・S-1提出（10営業日以内）","Roth CEF commences — S-1 within 10 business days"),
            jp("Yorkville再交渉（条件付き）","Yorkville renegotiation (conditional)"),
            jp("トークンレイズ開始","Token raise launch"),
        ],
    }
    for phase,actions in tl_data.items():
        with st.expander(phase, expanded=("今すぐ" in phase or "Now" in phase)):
            for a in actions:
                st.markdown(f"- {a}")

st.divider()
st.caption(jp("Instinct Brothers Holdings | 統合資本管理シミュレーター | 社外秘 | May 2026",
              "Instinct Brothers Holdings | Integrated Capital Simulator | Confidential | May 2026"))
