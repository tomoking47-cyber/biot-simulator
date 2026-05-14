import streamlit as st
import pandas as pd
import plotly.graph_objects as go

st.set_page_config(
    page_title="BIOT Capital Structure Simulator",
    page_icon="📊",
    layout="wide"
)

PASSWORD = "biot2026"
if "authenticated" not in st.session_state:
    st.session_state.authenticated = False

if not st.session_state.authenticated:
    st.title("🔒 BIOT Capital Structure Simulator")
    pwd = st.text_input("パスワードを入力してください", type="password")
    if st.button("ログイン"):
        if pwd == PASSWORD:
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("パスワードが違います")
    st.stop()

SHARES_OUT = 15_000_000
KW_AMOUNT = 5_000_000
ROTH_DRAW = 10_000_000
ROTH_CAP = 0.1999
YK_AMOUNT = 3_000_000
YK_FLOOR = 1.00

def dilution(new_shares):
    return (new_shares / (SHARES_OUT + new_shares)) * 100

st.title("📊 Instinct Brothers Holdings — Capital Structure Simulator")
st.caption("発行済株数 15,000,000株 ／ 上場予定価格 $10.00 ／ CONFIDENTIAL")

st.divider()

price = st.slider(
    "株価 (USD)",
    min_value=1.0,
    max_value=25.0,
    value=10.0,
    step=0.5,
    format="$%.2f"
)

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

col1, col2, col3 = st.columns(3)

with col1:
    st.markdown("### ✅ Kadenwood Group")
    st.caption("$5M Convertible Note — Pre-listing")
    st.markdown("**18% ディスカウント**")
    k1, k2, k3 = st.columns(3)
    k1.metric("転換価格", f"${kw18_conv:.2f}")
    k2.metric("発行株数", f"{kw18_shares:,}")
    k3.metric("希薄化率", f"{kw18_dil:.1f}%")
    st.markdown("**30% ディスカウント**")
    k4, k5, k6 = st.columns(3)
    k4.metric("転換価格", f"${kw30_conv:.2f}")
    k5.metric("発行株数", f"{kw30_shares:,}")
    k6.metric("希薄化率", f"{kw30_dil:.1f}%")

with col2:
    st.markdown("### ✅ Roth Principal Investments")
    st.caption("$50M CEF — Post-listing（$10M引出時）")
    r1, r2 = st.columns(2)
    r1.metric("取引価格 (97%VWAP)", f"${roth_price:.2f}")
    r2.metric("発行株数/$10M", f"{roth_shares:,}")
    r3, r4 = st.columns(2)
    r3.metric("19.99%キャップ到達額", f"${roth_cap_amt/1_000_000:.1f}M")
    r4.metric("コスト", "~5%")
    st.success("発行者コントロール：完全")

with col3:
    st.markdown("### ❌ Yorkville Advisors")
    st.caption("$3M Pre-Paid — Yorkvilleが転換タイミング決定")
    y1, y2 = st.columns(2)
    floor_hit = yk_conv_raw <= YK_FLOOR
    y1.metric("転換価格", f"${yk_conv:.2f}", delta="フロア到達" if floor_hit else None, delta_color="inverse")
    y2.metric("発行株数", f"{yk_shares:,}")
    y3, y4 = st.columns(2)
    y3.metric("フロア価格", "$1.00（固定）")
    y4.metric("月次償還(VWAP<$1)", "$802,500")
    st.error("年換算償還額 = 売上の430%")
    if price <= 3:
        st.warning("⚠️ この株価帯はAmortisation Eventリスクゾーンです")

st.divider()
st.subheader("希薄化率 比較")

fig = go.Figure()
categories = ["Kadenwood 18%", "Kadenwood 30%", "Yorkville"]
values = [kw18_dil, kw30_dil, yk_dil]
colors = ["#1D9E75", "#0F6E56", "#E24B4A"]

fig.add_trace(go.Bar(
    x=values,
    y=categories,
    orientation='h',
    marker_color=colors,
    text=[f"{v:.1f}%" for v in values],
    textposition='outside',
    width=0.5
))

fig.update_layout(
    xaxis_title="希薄化率 (%)",
    xaxis=dict(range=[0, 25], showgrid=True, gridcolor="#eee"),
    yaxis=dict(showgrid=False),
    plot_bgcolor="white",
    paper_bgcolor="white",
    height=200,
    margin=dict(l=10, r=60, t=10, b=30),
    font=dict(size=13)
)

st.plotly_chart(fig, use_container_width=True)

if price < 2:
    st.error("⚠️ 深刻な希薄化ゾーン。全転換社債で株主価値の大幅毀損が発生します。Yorkvilleは絶対に回避してください。")
elif price <= 5:
    st.warning("⚠️ 注意ゾーン。KadenwoodとYorkvilleの希薄化率が上昇しています。Rothは引き続き発行者コントロール可。")
elif price >= 15:
    st.success("✅ 良好ゾーン。全転換において希薄化率が低水準です。上場後の株価維持が最重要課題です。")
else:
    st.info("✅ 標準ゾーン（上場想定価格$10付近）。Kadenwood + Roth の推奨スタックが最適解です。")

st.divider()
st.caption("Instinct Brothers Holdings | Capital Structure Analysis | Strictly Confidential | May 2026")
