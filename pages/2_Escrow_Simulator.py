"""
BIOT ROTH CEF 調達・希薄化シミュレーター
------------------------------------------------
biot-simulator の「pages/」フォルダに置くだけで
左サイドバーに新しいページとして自動表示される。

ROTH Principal Investments の Committed Equity Facility (CEF) を
タームシート(2026/6/5)の条件どおりにモデル化。
調達額を動かすと、ナガノ含む全株主の持株比率が自動で再計算される。
"""

import numpy as np
import streamlit as st
import plotly.graph_objects as go

# ====== 確定CAP TABLE（最終版・調達前）======
# (名称, 株数, ロックアップ)
CAP_TABLE = [
    ("Public Stockholders",            40_622,     "Nil"),
    ("Tomoki Nagano",                  10_425_115, "12ヶ月"),
    ("Tomoki Nagano (Chardan充当)",    1_615_385,  "—"),
    ("Officer/Director/近親者",         73_100,     "12ヶ月"),
    ("Target Stockholders",            9_936_400,  "Nil"),
    ("Chardan",                        1_615_385,  "Nil"),
    ("Everise Concepts PLT",           450_000,    "Nil"),
    ("Initial Stockholders(SP除く)",    738_369,    "12ヶ月"),
    ("Sponsor",                        5_515_481,  "一部エスクロー"),
    ("Sponsor's service providers",    845_000,    "—"),
    ("New Share Issuance (CEF・既存)", 10_000_000, "Nil"),
]
TOTAL_BASE = sum(s for _, s, _ in CAP_TABLE)   # 41,254,857
NAGANO_ROWS = ["Tomoki Nagano", "Tomoki Nagano (Chardan充当)"]
BLOCK_LINE = 33.34   # 特別決議拒否権ライン

# ====== ROTH CEF タームシート条件 ======
DISCOUNT = 0.03            # 発行価格 = VWAPの97%
EXCHANGE_CAP_PCT = 0.1999  # 株主承認なしの発行上限
PRICE_FLOOR = 1.00         # 前日終値$1未満は引出不可
COMMIT_FEE_PCT = 0.02      # コミットメントフィー2%
RAISE_MIN = 10_000_000     # 最低
RAISE_MAX = 150_000_000    # 最大枠

st.set_page_config(page_title="ROTH CEF シミュレーター", page_icon="💰", layout="wide")
st.title("💰 ROTH CEF 調達・希薄化シミュレーター")
st.caption("ROTH Principal Investments の Committed Equity Facility をタームシート条件で試算。"
           "調達額を動かすと全株主の持株比率が自動再計算される。株価予測ではなく計画ツール。")

# ====== 入力 ======
with st.sidebar:
    st.header("入力")

    st.subheader("調達額")
    raise_target = st.slider("CEF調達目標額 ($)", RAISE_MIN, RAISE_MAX, 
                             RAISE_MIN, 5_000_000,
                             help="最低$10M〜最大枠$150M。ただしExchange Capで実際の上限は株価次第")

    st.subheader("引き出し時の株価")
    mode = st.radio("株価の置き方", ["固定値で見る", "確率分布で見る(モンテカルロ)"], index=0)
    if mode == "固定値で見る":
        px_fixed = st.slider("引き出し時の株価 ($)", 0.5, 15.0, 4.0, 0.1)
    else:
        p_low  = st.slider("悲観の株価 ($)", 0.5, 5.0, 2.0, 0.1)
        p_mode = st.slider("最頻の株価 ($)", 1.0, 10.0, 4.0, 0.1)
        p_high = st.slider("楽観の株価 ($)", 2.0, 15.0, 6.0, 0.1)

    st.subheader("発行上限")
    approved = st.checkbox("株主承認あり(Exchange Cap 19.99%を解除)", value=False,
                           help="未チェックなら発行済の19.99%が上限")

# ====== 計算ロジック ======
def compute(price, raise_amt, approved):
    """1つの株価について、CEF調達結果を計算"""
    if price < PRICE_FLOOR:
        return dict(can_draw=False, shares=0, raised=0, total=TOTAL_BASE, capped=False)
    issue_price = price * (1 - DISCOUNT)
    need_shares = raise_amt / issue_price
    cap_shares = TOTAL_BASE * EXCHANGE_CAP_PCT
    if approved:
        actual_shares = need_shares
        capped = False
    else:
        actual_shares = min(need_shares, cap_shares)
        capped = need_shares > cap_shares
    raised = actual_shares * issue_price
    total = TOTAL_BASE + actual_shares
    return dict(can_draw=True, shares=actual_shares, raised=raised, 
                total=total, capped=capped, issue_price=issue_price)

# ====== 固定値モード ======
if mode == "固定値で見る":
    r = compute(px_fixed, raise_target, approved)
    
    st.subheader("調達結果")
    if not r["can_draw"]:
        st.error(f"🔴 引き出し不可 — 株価${px_fixed:.2f}は$1フロアを下回る。CEFは使えない。")
        st.stop()
    
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("実際の調達額", f"${r['raised']:,.0f}", 
              f"目標 ${raise_target:,.0f}")
    c2.metric("発行株数", f"{r['shares']:,.0f}株", 
              f"@ ${r['issue_price']:.2f} (VWAP97%)")
    c3.metric("発行後 総株数", f"{r['total']:,.0f}", 
              f"+{r['shares']:,.0f}")
    c4.metric("希薄化率", f"{r['shares']/r['total']*100:.1f}%")
    
    if r["capped"]:
        st.error(f"🔴 Exchange Cap到達 — 株主承認なしでは{TOTAL_BASE*EXCHANGE_CAP_PCT:,.0f}株"
                 f"(19.99%)が上限。目標${raise_target:,.0f}に対し実際は${r['raised']:,.0f}しか引けない。"
                 "株主承認を取れば枠を解除できる。")
    else:
        commit_fee = raise_target * COMMIT_FEE_PCT
        st.success(f"良好 — 目標額を満額調達可能。希薄化{r['shares']/r['total']*100:.1f}%。"
                   f"(コミットメントフィー2%=${commit_fee:,.0f}は別途)")
    
    # 全株主の比率を自動再計算
    st.subheader("全株主の持株比率（調達後・自動反映）")
    new_total = r["total"]
    rows = []
    for name, sh, lock in CAP_TABLE:
        before = sh / TOTAL_BASE * 100
        after = sh / new_total * 100
        rows.append((name, sh, before, after, after-before))
    # CEF新規発行行を追加
    rows.append(("★ ROTH CEF (新規発行)", r["shares"], 0, r["shares"]/new_total*100, 
                 r["shares"]/new_total*100))
    
    # テーブル表示
    import pandas as pd
    df = pd.DataFrame(rows, columns=["株主", "株数", "発行前%", "発行後%", "増減pt"])
    df["株数"] = df["株数"].apply(lambda x: f"{x:,.0f}")
    df["発行前%"] = df["発行前%"].apply(lambda x: f"{x:.2f}%")
    df["発行後%"] = df["発行後%"].apply(lambda x: f"{x:.2f}%")
    df["増減pt"] = df["増減pt"].apply(lambda x: f"{x:+.2f}")
    st.dataframe(df, use_container_width=True, hide_index=True)
    
    # ナガノ拒否権チェック
    nag_before = sum(sh for name,sh,_ in CAP_TABLE if name in NAGANO_ROWS)/TOTAL_BASE*100
    nag_after = sum(sh for name,sh,_ in CAP_TABLE if name in NAGANO_ROWS)/new_total*100
    st.subheader("ナガノ持株比率と拒否権ライン")
    n1, n2, n3 = st.columns(3)
    n1.metric("発行前", f"{nag_before:.2f}%")
    n2.metric("発行後", f"{nag_after:.2f}%", f"{nag_after-nag_before:+.2f}pt", delta_color="inverse")
    n3.metric("拒否権ライン", f"{BLOCK_LINE}%", 
              "割れている" if nag_after < BLOCK_LINE else "確保")
    if nag_after < BLOCK_LINE:
        st.warning(f"⚠️ 発行後ナガノ {nag_after:.2f}% は拒否権ライン{BLOCK_LINE}%を下回る。"
                   "特別決議の単独阻止権を失う水準。増資は取締役会判断を。")

# ====== モンテカルロモード ======
else:
    if not (p_low <= p_mode <= p_high):
        st.error("⚠️ 株価は 悲観 ≤ 最頻 ≤ 楽観 の順で。")
        st.stop()
    
    N = 10000
    rng = np.random.default_rng(42)
    px = rng.triangular(p_low, p_mode, p_high, N)
    
    res_raised = np.zeros(N)
    res_shares = np.zeros(N)
    res_nag = np.zeros(N)
    can_draw = px >= PRICE_FLOOR
    cap_shares = TOTAL_BASE * EXCHANGE_CAP_PCT
    
    issue_price = px * (1 - DISCOUNT)
    need_shares = np.where(can_draw, raise_target / issue_price, 0)
    if approved:
        actual_shares = need_shares
    else:
        actual_shares = np.minimum(need_shares, cap_shares)
    res_shares = actual_shares
    res_raised = actual_shares * issue_price
    total_after = TOTAL_BASE + actual_shares
    nag_shares = sum(sh for name,sh,_ in CAP_TABLE if name in NAGANO_ROWS)
    res_nag = nag_shares / total_after * 100
    capped_prob = (need_shares > cap_shares).mean()*100 if not approved else 0
    
    st.subheader("調達結果（モンテカルロ 1万通り）")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("実際の調達額 中央値", f"${np.median(res_raised):,.0f}", 
              f"目標 ${raise_target:,.0f}")
    c2.metric("発行株数 中央値", f"{np.median(res_shares):,.0f}株")
    c3.metric("ナガノ比率 中央値", f"{np.median(res_nag):.2f}%", 
              f"拒否権{BLOCK_LINE}%")
    c4.metric("Exchange Cap超過確率", f"{capped_prob:.1f}%")
    
    prob_floor = (~can_draw).mean()*100
    prob_full = (res_raised >= raise_target*0.99).mean()*100
    prob_nag_below = (res_nag < BLOCK_LINE).mean()*100
    
    if prob_floor > 5:
        st.error(f"🔴 $1フロアで引出不可の確率 {prob_floor:.1f}% — 株価が低いと調達できないリスク。")
    st.info(f"目標額をほぼ満額引ける確率: {prob_full:.1f}% / "
            f"ナガノが拒否権ライン割れの確率: {prob_nag_below:.1f}%")
    
    # 調達額の分布
    fig = go.Figure()
    fig.add_trace(go.Histogram(x=res_raised, nbinsx=50, marker_color="#2E86AB"))
    fig.add_vline(x=raise_target, line_dash="dash", line_color="red",
                  annotation_text=f"目標 ${raise_target/1e6:.0f}M")
    fig.update_layout(height=320, xaxis_title="実際の調達額 ($)", yaxis_title="頻度",
                      margin=dict(l=10,r=10,t=10,b=10))
    st.plotly_chart(fig, use_container_width=True)

with st.expander("前提・タームシート条件"):
    st.markdown(
        f"- **発行価格** = 当日VWAPの97%（3%ディスカウント）。事前固定価格ではない。\n"
        f"- **$1フロア**: 前日終値が$1.00未満の日はCEF引出不可。\n"
        f"- **Exchange Cap**: 株主承認なしでは発行済の19.99%（{TOTAL_BASE*EXCHANGE_CAP_PCT:,.0f}株）が上限。\n"
        f"- **調達枠**: 最低$10M〜最大$150M。引出タイミングは完全に会社裁量。\n"
        f"- **コミットメントフィー**: 枠の2.0%（未使用なら不発生）。\n"
        f"- **ROTH保有上限**: 4.99%。\n"
        "- 本ツールは計画用。最終条件・登録・税務はDEC確認。"
    )
