"""
BIOT ROTH CEF 調達・希薄化シミュレーター
pages/ フォルダに置くと左サイドバーに自動表示される。
ROTH Principal Investments の Committed Equity Facility をタームシート条件でモデル化。
※ pandas不使用（依存を減らし表示エラーを回避）
"""

import numpy as np
import streamlit as st
import plotly.graph_objects as go

# ====== 確定CAP TABLE（最終版・調達前）======
CAP_TABLE = [
    ("Public Stockholders",            40_622),
    ("Tomoki Nagano",                  10_425_115),
    ("Tomoki Nagano (Chardan充当)",    1_615_385),
    ("Officer/Director/近親者",         73_100),
    ("Target Stockholders",            9_936_400),
    ("Chardan",                        1_615_385),
    ("Everise Concepts PLT",           450_000),
    ("Initial Stockholders(SP除く)",    738_369),
    ("Sponsor",                        5_515_481),
    ("Sponsor's service providers",    845_000),
    ("New Share Issuance (CEF・既存)", 10_000_000),
]
TOTAL_BASE = sum(s for _, s in CAP_TABLE)   # 41,254,857
NAGANO_ROWS = ["Tomoki Nagano", "Tomoki Nagano (Chardan充当)"]
NAGANO_SHARES = sum(s for n, s in CAP_TABLE if n in NAGANO_ROWS)
BLOCK_LINE = 33.34

# ====== ROTH CEF タームシート条件 ======
DISCOUNT = 0.03
EXCHANGE_CAP_PCT = 0.1999
PRICE_FLOOR = 1.00
COMMIT_FEE_PCT = 0.02
RAISE_MIN = 10_000_000
RAISE_MAX = 150_000_000

st.set_page_config(page_title="ROTH CEF シミュレーター", page_icon="💰", layout="wide")
st.title("💰 ROTH CEF 調達・希薄化シミュレーター")
st.caption("ROTHのCEFをタームシート条件で試算。調達額を動かすと全株主の持株比率が自動再計算。"
           "株価予測ではなく前提による計画ツール。")

with st.sidebar:
    st.header("入力")
    raise_target = st.slider("CEF調達目標額 ($)", RAISE_MIN, RAISE_MAX, RAISE_MIN, 5_000_000,
                             help="最低$10M〜最大枠$150M。Exchange Capで実際の上限は株価次第")
    px_fixed = st.slider("引き出し時の株価 ($)", 0.5, 15.0, 4.0, 0.1)
    approved = st.checkbox("株主承認あり（Exchange Cap 19.99%を解除）", value=False)
    st.divider()
    mc = st.checkbox("モンテカルロで確率も見る", value=False)
    if mc:
        p_low  = st.slider("悲観の株価 ($)", 0.5, 5.0, 2.0, 0.1)
        p_mode = st.slider("最頻の株価 ($)", 1.0, 10.0, 4.0, 0.1)
        p_high = st.slider("楽観の株価 ($)", 2.0, 15.0, 6.0, 0.1)

# ====== 計算 ======
def compute(price, raise_amt, approved):
    if price < PRICE_FLOOR:
        return None
    issue_price = price * (1 - DISCOUNT)
    need = raise_amt / issue_price
    cap = TOTAL_BASE * EXCHANGE_CAP_PCT
    actual = need if approved else min(need, cap)
    capped = (not approved) and need > cap
    total = TOTAL_BASE + actual
    return dict(issue_price=issue_price, shares=actual, raised=actual*issue_price,
                total=total, capped=capped)

r = compute(px_fixed, raise_target, approved)

st.subheader("調達結果")
if r is None:
    st.error(f"🔴 引き出し不可 — 株価 ${px_fixed:.2f} は $1 フロアを下回る。CEFは使えない。")
    st.stop()

c1, c2, c3, c4 = st.columns(4)
c1.metric("実際の調達額", f"${r['raised']:,.0f}", f"目標 ${raise_target:,.0f}")
c2.metric("発行株数", f"{r['shares']:,.0f}株", f"@ ${r['issue_price']:.2f}")
c3.metric("発行後 総株数", f"{r['total']:,.0f}", f"+{r['shares']:,.0f}")
c4.metric("希薄化率", f"{r['shares']/r['total']*100:.1f}%")

if r["capped"]:
    st.error(f"🔴 Exchange Cap到達 — 株主承認なしでは {TOTAL_BASE*EXCHANGE_CAP_PCT:,.0f}株(19.99%)が上限。"
             f"目標 ${raise_target:,.0f} に対し実際は ${r['raised']:,.0f} しか引けない。株主承認で解除可。")
else:
    st.success(f"良好 — 目標額を満額調達可能。希薄化 {r['shares']/r['total']*100:.1f}%。"
               f"（コミットメントフィー2%=${raise_target*COMMIT_FEE_PCT:,.0f} は別途）")

# ====== 全株主比率 自動再計算（pandasなし・st.table用の辞書リスト）======
st.subheader("全株主の持株比率（調達後・自動反映）")
new_total = r["total"]
table_rows = []
for name, sh in CAP_TABLE:
    before = sh / TOTAL_BASE * 100
    after = sh / new_total * 100
    table_rows.append({
        "株主": name,
        "株数": f"{sh:,}",
        "発行前%": f"{before:.2f}%",
        "発行後%": f"{after:.2f}%",
        "増減": f"{after-before:+.2f}pt",
    })
table_rows.append({
    "株主": "★ ROTH CEF (新規)",
    "株数": f"{r['shares']:,.0f}",
    "発行前%": "—",
    "発行後%": f"{r['shares']/new_total*100:.2f}%",
    "増減": f"+{r['shares']/new_total*100:.2f}pt",
})
st.table(table_rows)

# ====== ナガノ拒否権 ======
st.subheader("ナガノ持株比率と拒否権ライン")
nag_before = NAGANO_SHARES / TOTAL_BASE * 100
nag_after = NAGANO_SHARES / new_total * 100
n1, n2, n3 = st.columns(3)
n1.metric("発行前", f"{nag_before:.2f}%")
n2.metric("発行後", f"{nag_after:.2f}%", f"{nag_after-nag_before:+.2f}pt", delta_color="inverse")
n3.metric("拒否権ライン", f"{BLOCK_LINE}%", "割れている" if nag_after < BLOCK_LINE else "確保")
if nag_after < BLOCK_LINE:
    st.warning(f"⚠️ 発行後ナガノ {nag_after:.2f}% は拒否権ライン {BLOCK_LINE}% を下回る。"
               "特別決議の単独阻止権を失う水準。増資は取締役会判断を。")

# ====== 持株比率バー ======
fig = go.Figure()
others = [(n, s) for n, s in CAP_TABLE if n not in NAGANO_ROWS]
fig.add_trace(go.Bar(name="ナガノ合算", x=["発行前", "発行後"],
                     y=[nag_before, nag_after], marker_color="#2E86AB"))
fig.add_trace(go.Bar(name="ROTH CEF新規", x=["発行前", "発行後"],
                     y=[0, r['shares']/new_total*100], marker_color="#C73E1D"))
fig.add_hline(y=BLOCK_LINE, line_dash="dot", line_color="orange",
              annotation_text=f"拒否権 {BLOCK_LINE}%")
fig.update_layout(barmode="group", height=300, yaxis_title="%",
                  margin=dict(l=10, r=10, t=10, b=10))
st.plotly_chart(fig, use_container_width=True)

# ====== モンテカルロ（任意）======
if mc:
    st.divider()
    st.subheader("モンテカルロ（株価1万通り）")
    if not (p_low <= p_mode <= p_high):
        st.error("株価は 悲観 ≤ 最頻 ≤ 楽観 の順で。")
    else:
        rng = np.random.default_rng(42)
        px = rng.triangular(p_low, p_mode, p_high, 10000)
        can_draw = px >= PRICE_FLOOR
        ip = px * (1 - DISCOUNT)
        need = np.where(can_draw, raise_target / ip, 0)
        cap = TOTAL_BASE * EXCHANGE_CAP_PCT
        actual = need if approved else np.minimum(need, cap)
        raised = actual * ip
        nag = NAGANO_SHARES / (TOTAL_BASE + actual) * 100

        m1, m2, m3 = st.columns(3)
        m1.metric("調達額 中央値", f"${np.median(raised):,.0f}")
        m2.metric("満額引ける確率", f"{(raised>=raise_target*0.99).mean()*100:.1f}%")
        m3.metric("ナガノ拒否権割れ確率", f"{(nag<BLOCK_LINE).mean()*100:.1f}%")
        if (~can_draw).mean() > 0.05:
            st.error(f"🔴 $1フロアで引出不可の確率 {(~can_draw).mean()*100:.1f}%")

        figm = go.Figure()
        figm.add_trace(go.Histogram(x=raised, nbinsx=50, marker_color="#2E86AB"))
        figm.add_vline(x=raise_target, line_dash="dash", line_color="red",
                       annotation_text=f"目標 ${raise_target/1e6:.0f}M")
        figm.update_layout(height=300, xaxis_title="実際の調達額 ($)", yaxis_title="頻度",
                           margin=dict(l=10, r=10, t=10, b=10))
        st.plotly_chart(figm, use_container_width=True)

with st.expander("前提・タームシート条件"):
    st.markdown(
        f"- 発行価格 = 当日VWAPの97%（3%ディスカウント）。事前固定ではない。\n"
        f"- $1フロア：前日終値$1.00未満の日は引出不可。\n"
        f"- Exchange Cap：株主承認なしでは発行済の19.99%（{TOTAL_BASE*EXCHANGE_CAP_PCT:,.0f}株）が上限。\n"
        f"- 調達枠：最低$10M〜最大$150M。引出タイミングは会社裁量。\n"
        f"- コミットメントフィー：枠の2.0%（未使用なら不発生）。ROTH保有上限4.99%。\n"
        f"- 調達先はROTHのみ。最終条件・登録・税務はDEC確認。"
    )
