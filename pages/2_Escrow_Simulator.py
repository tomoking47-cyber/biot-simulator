"""
BIOT エスクロー回収 モンテカルロ・シミュレーター（確率版）
------------------------------------------------
biot-simulator の「pages/」フォルダに置くだけで
左サイドバーに新しいページとして自動表示される。

決定論版（2_Escrow_Simulator.py）の進化版。
始値を乱数で1万通り振り、「500K株でAP目標額を回収できる確率」を出す。
"""

import numpy as np
import streamlit as st
import plotly.graph_objects as go

# ====== 固定値（最終CAP TABLEより）======
TOTAL          = 41_254_857    # 発行済株式総数（確定）
NAGANO         = 10_425_115    # ナガノ本体
NAGANO_CHARDAN = 1_615_385     # ナガノ（Chardan充当新株）
NAGANO_TOTAL   = NAGANO + NAGANO_CHARDAN  # ナガノ合算
BLOCK_LINE     = 33.34         # 特別決議拒否権ライン(%)
ESCROW_TOTAL   = 1_000_000     # エスクロー総数
ESCROW_TAREK   = 500_000       # Tarek取り分（無条件）
ESCROW_AP      = 500_000       # AP回収用

st.set_page_config(page_title="エスクロー確率シミュレーター", page_icon="🎲", layout="wide")
st.title("🎲 エスクロー回収 モンテカルロ・シミュレーター")
st.caption("始値を1万通り乱数で振り、『500K株でAP目標額を回収できる確率』を試算。"
           "決定論版と違い、結果は確率分布で出る。株価予測ではなく、前提による計画ツール。")

# ====== 入力 ======
with st.sidebar:
    st.header("入力")

    st.subheader("回収目標")
    target = st.number_input("回収目標額 ($) ＝APの充当対象分", 
                             100_000, 3_000_000, 1_500_000, 50_000)
    esc_ap = st.number_input("AP回収に使うエスクロー株数", 
                             100_000, 1_000_000, ESCROW_AP, 50_000)

    st.subheader("始値の前提（三角分布）")
    p_low  = st.slider("悲観の始値 ($)", 0.5, 5.0, 2.0, 0.1)
    p_mode = st.slider("最頻の始値 ($)", 1.0, 10.0, 4.0, 0.1)
    p_high = st.slider("楽観の始値 ($)", 2.0, 15.0, 6.0, 0.1)

    st.subheader("売却条件")
    discount = st.slider("売却ディスカウント (%)", 0, 30, 5, 1,
                         help="他者の売り圧力等で始値より安く売れる前提") / 100

    st.subheader("試行回数")
    n_trials = st.select_slider("モンテカルロ試行回数", 
                                [1000, 5000, 10000, 50000], value=10000)

# ====== 入力の妥当性チェック ======
if not (p_low <= p_mode <= p_high):
    st.error("⚠️ 始値は 悲観 ≤ 最頻 ≤ 楽観 の順で設定してください。")
    st.stop()

# ====== モンテカルロ計算 ======
rng = np.random.default_rng(42)
p0 = rng.triangular(p_low, p_mode, p_high, n_trials)
esc_price = p0 * (1 - discount)

# 500K株フル売却時の回収額
recovery = esc_ap * esc_price
success = recovery >= target
prob_success = success.mean() * 100

# 目標達成に必要な株価
price_needed = target / esc_ap

# 分布
p10, p50, p90 = np.percentile(recovery, [10, 50, 90])

# ====== 出力：回収確率 ======
st.subheader("回収シミュレーション結果")
c1, c2, c3, c4 = st.columns(4)
c1.metric("★ 目標達成確率", f"{prob_success:.1f}%", 
          f"目標 ${target:,.0f}")
c2.metric("回収額 中央値", f"${p50:,.0f}", 
          f"P10 ${p10:,.0f} 〜 P90 ${p90:,.0f}")
c3.metric("達成に必要な株価", f"${price_needed:.2f}", 
          "この株価が分水嶺")
c4.metric("試行回数", f"{n_trials:,}")

if prob_success >= 80:
    st.success(f"良好 — {esc_ap:,}株で${target:,.0f}を回収できる確率は {prob_success:.1f}%。"
               f"株価が${price_needed:.2f}を超えれば達成が見込める。")
elif prob_success >= 50:
    st.warning(f"中程度 — 達成確率 {prob_success:.1f}%。始値が${price_needed:.2f}を割ると未達。"
               f"目標額の見直し or 始値を押し上げるIR施策を検討。")
else:
    st.error(f"危険 — 達成確率わずか {prob_success:.1f}%。"
             f"現状の始値前提では${target:,.0f}の回収は困難。設計の見直しが必要。")

# ====== 株価帯別の達成率 ======
st.subheader("始値の価格帯ごとの達成率")
bands = [(0,2),(2,3),(3,4),(4,5),(5,6),(6,99)]
rows = []
for lo, hi in bands:
    mask = (p0>=lo)&(p0<hi)
    if mask.sum() > 0:
        rate = (recovery[mask]>=target).mean()*100
        rows.append((f"${lo}-${hi if hi<99 else '∞'}", mask.sum(), rate))

fig_band = go.Figure()
fig_band.add_trace(go.Bar(
    x=[r[0] for r in rows], y=[r[2] for r in rows],
    text=[f"{r[2]:.0f}%" for r in rows], textposition="outside",
    marker_color=["#C73E1D" if r[2]<50 else "#EF9F27" if r[2]<90 else "#1D9E75" for r in rows]
))
fig_band.update_layout(height=300, yaxis_title="達成率 (%)", xaxis_title="始値の価格帯",
                       margin=dict(l=10,r=10,t=10,b=10), yaxis_range=[0,110])
st.plotly_chart(fig_band, use_container_width=True)

# ====== 回収額の分布ヒストグラム ======
st.subheader("回収額の分布（1万通りの結果）")
fig_hist = go.Figure()
fig_hist.add_trace(go.Histogram(x=recovery, nbinsx=60, marker_color="#1D9E75"))
fig_hist.add_vline(x=target, line_dash="dash", line_color="red",
                   annotation_text=f"目標 ${target:,.0f}", annotation_position="top")
fig_hist.add_vline(x=p50, line_dash="dot", line_color="navy",
                   annotation_text=f"中央値 ${p50:,.0f}", annotation_position="top left")
fig_hist.update_layout(height=320, xaxis_title="回収額 ($)", yaxis_title="頻度",
                       margin=dict(l=10,r=10,t=10,b=10))
st.plotly_chart(fig_hist, use_container_width=True)

# ====== ナガノ拒否権ライン参考表示 ======
st.subheader("参考：ナガノ持株比率（拒否権ライン）")
nag_pct = NAGANO_TOTAL / TOTAL * 100
n1, n2 = st.columns(2)
n1.metric("ナガノ合算 持株比率", f"{nag_pct:.2f}%", 
          f"拒否権ライン {BLOCK_LINE}%")
if nag_pct < BLOCK_LINE:
    n2.metric("拒否権ライン", "⚠️ 既に割れている", 
              f"{nag_pct-BLOCK_LINE:.2f}pt", delta_color="inverse")
    st.error(f"⚠️ ナガノ合算 {nag_pct:.2f}% は特別決議拒否権ライン {BLOCK_LINE}% を下回っている。"
             "増資シナリオは取締役会判断が必要。")
else:
    n2.metric("拒否権ライン", "確保", f"+{nag_pct-BLOCK_LINE:.2f}pt")

with st.expander("前提・注記"):
    st.markdown(
        f"- **エスクロー設計**: 総数{ESCROW_TOTAL:,}株 → Tarek {ESCROW_TAREK:,}株(無条件) / "
        f"AP回収用 {ESCROW_AP:,}株。\n"
        "- **始値は三角分布**で乱数生成（悲観・最頻・楽観の3点）。株価予測ではない。\n"
        "- 回収額 = AP用株数 × 始値 ×(1−ディスカウント)。早期売却=始値近辺で売れる前提。\n"
        "- **目標額はAPの一部充当分**。AP総額の全額ではない（残りはTrust・現金等で別途）。\n"
        "- Rule 144・登録状況・二重回収禁止はDEC確認事項。本ツールは計画用。\n"
        "- ナガノ拒否権ラインは参考値。正確な議決権はクラス株設計をDEC確認。"
    )
