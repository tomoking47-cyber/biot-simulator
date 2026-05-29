"""
BIOT エスクロー株 売却・回収シミュレーター（v3）
------------------------------------------------
Streamlit 用ページ。biot-simulator アプリの「pages/」フォルダに置くだけで
左サイドバーに新しいページとして自動表示される（app.py の編集は不要）。

実装内容：
  ・Sponsor / Chardan の売却量スライダー → 株価インパクト
  ・エスクロー1M の回収ベース → BIOT回収額 vs Sponsorへの返還
  ・ナガノ・ボーナス発行 → 希薄化と発行時期リスク
"""

import math
import streamlit as st
import plotly.graph_objects as go

# ====== 固定値（確定済みCAP TABLE・契約より）======
CHARDAN       = 1_615_385      # Chardan 和解株（登録済・自由売買）
ESCROW        = 1_000_000      # エスクロー株（Sponsor 5.5M の内数）
SPONSOR_DISC  = 4_515_481      # Sponsor のうちエスクローを除く裁量分
SPONSOR_TOTAL = 5_515_481      # Sponsor 合計
FLOAT_EFF     = 7_912_977      # 実効流通株（New Public は売らない前提で除外）
CAP144        = 1_217_000      # Rule 144 アフィリエイト 年間目安（1%×4四半期）
NAGANO        = 12_040_500     # Nagano（Sellers）保有
TOTAL         = 30_412_977     # 発行済株式総数

st.set_page_config(page_title="エスクロー シミュレーター", page_icon="💠", layout="wide")
st.title("💠 エスクロー株 売却・回収シミュレーター")
st.caption("Sponsor／Chardanの売却量・想定株価から、株価インパクトとエスクロー回収（残はSponsorへ返還）、"
           "ナガノ・ボーナス発行の希薄化までを試算。数値は前提による計画ツールで、株価予測ではない。")

# ====== 入力 ======
with st.sidebar:
    st.header("入力")

    st.subheader("売り圧力")
    p0       = st.slider("想定始値 P0 ($)", 0.50, 15.0, 11.0, 0.05)
    chardan  = st.slider("Chardan 売却 (%) ／1.6M", 0, 100, 100, 1)
    tarek    = st.slider("Tarek 裁量売却 (%) ／4.5M", 0, 100, 50, 1)
    depth    = st.slider("市場の吸収力＝深さ (株)", 1_000_000, 10_000_000, 3_000_000, 100_000,
                         help="この株数を売ると株価がおよそ半分になる、という流動性の前提")
    new_pub  = st.slider("New Public 売却 (株)", 0, 10_000, 0, 500)
    r144     = st.checkbox("Sponsor に Rule 144 制限を適用（年≈1.22M上限）", value=False)

    st.subheader("エスクロー回収")
    rec_base = st.slider("回収ベース＝対象実費 ($)", 290_791, 3_400_000, 290_791, 10_000,
                         help="正当な取引費用の範囲で上げるほど、Sponsorへの返還が減る")
    timing   = st.radio("エスクロー売却時期", ["早期（先取り・高値）", "後回し（圧力後）"], index=0)

    st.subheader("ナガノ・ボーナス発行")
    bonus    = st.slider("発行株数", 0, 2_000_000, 1_615_385, 5_000)
    b_month  = st.slider("発行時期（クロージング後・月）", 0, 12, 3, 1)

# ====== 計算（v3モデル）======
early = timing.startswith("早期")
ch_sh = CHARDAN * chardan / 100
tk_sh = SPONSOR_DISC * tarek / 100

# エスクロー売価：早期は始値、後回しは他者売却後の市場価格
esc_price = p0 if early else max(0.05, p0 * (1 - 0.5 * (ch_sh + tk_sh + new_pub) / depth))
used = min(ESCROW, math.ceil(rec_base / esc_price))

# Rule 144：Sponsor由来（裁量＋エスクロー）を年間上限で制限。エスクローを優先
if r144:
    tk_sh = min(tk_sh, max(0, CAP144 - used))

total_sold = ch_sh + tk_sh + new_pub + used
avg_price  = max(0.05, p0 * (1 - 0.5 * total_sold / depth))
captured   = min(rec_base, used * esc_price)
rev_shares = ESCROW - used
rev_value  = rev_shares * esc_price

new_total  = TOTAL + bonus
nag_new    = NAGANO + bonus

# ====== 出力：エスクロー回収 ======
st.subheader("エスクロー回収")
c1, c2, c3, c4 = st.columns(4)
c1.metric("推定 平均市場株価", f"${avg_price:,.2f}", f"{(avg_price/p0-1)*100:,.0f}% vs 始値")
c2.metric("BIOT回収額", f"${captured:,.0f}", f"{used:,.0f}株 @ ${esc_price:,.2f}")
c3.metric("Sponsorへ返還", f"{rev_shares:,.0f}株", f"≈ ${rev_value:,.0f} 相当", delta_color="inverse")
c4.metric("総売却株数", f"{total_sold:,.0f}", f"{total_sold/FLOAT_EFF*100:,.0f}% / 実効流通7.9M")

if rev_shares <= 100_000:
    st.success(f"良好 — 1Mのほぼ全量をBIOTで活用。Sponsorへの返還は {rev_shares:,.0f}株 まで圧縮。")
elif captured < rec_base - 1:
    st.error(f"上限到達 — ${esc_price:,.2f} では1M全部でも回収ベースに届かない"
             f"（回収 ${captured:,.0f} / 目標 ${rec_base:,.0f}）。早期売却 or 回収ベースの見直しを。")
else:
    st.warning(f"取りこぼし — {rev_shares:,.0f}株（≈${rev_value:,.0f}）がSponsorへ返還。"
               f"実費の範囲で回収ベースを拡大する余地あり。")

# ====== 出力：発行・希薄化 ======
st.subheader("発行・希薄化（ナガノ・ボーナス）")
d1, d2, d3, d4 = st.columns(4)
d1.metric("発行後 総株数", f"{new_total:,.0f}", f"+{bonus:,.0f} 新株")
d2.metric("ナガノ持株比率", f"{nag_new/new_total*100:,.1f}%", f"発行前 {NAGANO/TOTAL*100:,.1f}%")
d3.metric("他株主の希薄化", f"{(bonus/new_total*100) if bonus else 0:,.1f}%")
d4.metric("Rule 144 四半期上限(1%)", f"{new_total*0.01:,.0f}株")

if bonus == 0:
    st.info("ボーナス発行なし。")
elif b_month < 1:
    st.error("ボーナス時期リスク高 — クロージング時/前の発行は Chardan 反希薄化条件に抵触の恐れ。"
             "Chardan 受領後（1ヶ月以降）に。")
else:
    st.success("ボーナス時期OK（Chardan受領後）。取締役会/報酬委承認・8-K/Form 4開示・個人課税の手当てを。")

# ====== 売り圧力の内訳バー ======
st.subheader("売り圧力の内訳（実効流通株 7.9M 比）")
fig = go.Figure()
for name, val, color in [
    ("Chardan", ch_sh, "#E24B4A"),
    ("Tarek 裁量", tk_sh, "#EF9F27"),
    ("エスクロー", used, "#1D9E75"),
    ("New Public", new_pub, "#888780"),
]:
    fig.add_trace(go.Bar(y=["売り圧力"], x=[val], name=f"{name} ({val:,.0f})",
                         orientation="h", marker_color=color))
fig.update_layout(barmode="stack", height=160, margin=dict(l=10, r=10, t=10, b=10),
                  xaxis_title="株数", legend=dict(orientation="h"))
fig.add_vline(x=FLOAT_EFF, line_dash="dot", line_color="gray",
              annotation_text="実効流通株 7.9M", annotation_position="top")
st.plotly_chart(fig, use_container_width=True)

with st.expander("前提・注記"):
    st.markdown(
        "- 株価インパクトは「深さ」前提の簡易モデル。BIOT未上場でADV未確定のため予測ではない。\n"
        "- エスクローの未使用分は **Sponsorへ返還**。回収ベースを実費の範囲で上げるほど返還は縮む。\n"
        "- Rule 144 はSponsorがアフィリエイト＆未登録の場合の天然ブレーキ。登録状況はDEC確認。\n"
        "- ボーナス発行は **Chardan受領後**。反希薄化条件・関連当事者開示・個人課税に留意。\n"
        "- 二重回収禁止：① Promissory Note は相殺済で除外、② はTrustかエスクローの一方のみ。"
    )
