"""
BIOT 統合ディール・ダッシュボード（v4 / 全部入り）
=====================================================
biot-simulator アプリの「pages/」フォルダに置く。左サイドバーに自動表示。

この会話で確定した全要素を1画面に統合：
  ・CAP TABLE（ロックアップ別／売る・売らない）
  ・最終トラスト $518,872（2026/3/25 株主総会後）
  ・A/P $2,852,414.99（カテゴリ別。EGS $1.56M 等）
  ・エスクロー 50/50 分割（シナリオ A=スポンサー処理 / B=ボーナス転用＝BIOT負担）
  ・損益分岐：BIOT 500k vs $2.8M ＝ $5.70 ／ Tarek 500k vs $845k ＝ $1.69
  ・売り圧（Chardan 1.6M＋Sponsor 4.5M）と Rule 144 throttle / 登録自由化
  ・回収ベース Tier1 $290,791 → 最大 $691,240
  ・banker fee ≈$5.6M（放棄 / Tarek現金払い）
数値は前提に基づく計画ツール。株価予測ではない。最終判断は DEC・会計・弁護士の確認による。
"""

import math
import streamlit as st
import plotly.graph_objects as go

# ============================================================
# 簡易パスワード（機密データのため）
# ============================================================
PW = "biot2026"
if "auth_v4" not in st.session_state:
    st.session_state.auth_v4 = False
if not st.session_state.auth_v4:
    _pw = st.text_input("パスワードを入力", type="password")
    if _pw == PW:
        st.session_state.auth_v4 = True
        st.rerun()
    elif _pw:
        st.error("パスワードが違います。")
    st.stop()

# ============================================================
# 確定値（CAP TABLE 28,794,472・直近SEC開示・A/P 2026/3/31）
# ============================================================
TOTAL          = 28_794_472
NAGANO         = 10_425_115   # 12mo lock・売らない
TARGET         = 9_936_400    # Nil・売らない（アライン）
EVERISE        = 450_000      # Nil・売らない（関連当事者）
OFFICERS       = 73_100       # 12mo lock・売らない
INITIAL_EXSPON = 738_369      # 12mo lock（非スポンサーのファウンダー株）
PUBLIC         = 40_622       # Nil（真の公開株）
CHARDAN        = 1_615_385    # Nil・無償・即投げ
SPONSOR        = 5_515_481    # うち 1M エスクロー(6mo)＋4.5M 裁量(ロック無)
ESCROW         = 1_000_000
SPONSOR_DISC   = SPONSOR - ESCROW  # 4,515,481

ALIGNED_NOSELL = NAGANO + TARGET + EVERISE + OFFICERS  # 20,884,615 売らない

TRUST          = 518_872          # 最終トラスト（2026/3/25 株主総会後）
AP_TOTAL       = 2_852_414.99     # Relativity A/P 総額
BONUS_TOTAL    = 845_000          # Tarek が自分の 500k で払うボーナス

# A/P カテゴリ別（合計 = AP_TOTAL）
AP_CATS = {
    "法務 EGS/Loeb/Nixon/Garnett/Barnett": 1_906_409.38,
    "スポンサー関連 77th Division":          275_000.00,
    "IR・プロキシ・印刷 Toppan 等":          212_018.01,
    "株式代行・登記 CST 等":                 187_346.70,
    "監査・コンサル WITHUM 等":              145_012.23,
    "上場・証券・保険 Nasdaq 等":            126_628.67,
}
# ボーナス内訳（Tarek 500k が払う）
BONUS_ITEMS = {
    "Loeb & Loeb":                  200_000,
    "77th Division LLC【関連当事者】": 495_000,
    "AA Grants【要・素性確認】":       150_000,
}
# 回収ベース（BIOT 立替の段階別）
REC_TIER1 = 290_791   # 中核（現エスクロー・確実）
REC_TIER2 = 503_740   # ＋追加Promissory Note
REC_MAX   = 691_240   # ＋IPOコンサル（最大防御）

BANKER_FEE = 5_625_000  # A.G.P. 繰延報酬（概算）

R144_QUARTER = round(TOTAL * 0.01)      # 287,945
R144_YEAR    = R144_QUARTER * 4         # 1,151,780

# Nasdaq Capital Market 防衛線（2026/1版）
NSDQ_BID        = 1.00          # 株価
NSDQ_MVUPHS     = 25_000_000    # 制限なし公開株時価（De-SPAC合併後の必須関門）
NSDQ_HOLDERS    = 300           # 公開株主（round-lot）
NSDQ_PUB_SHARES = 500_000       # 公開株数
NSDQ_MVPHS      = 1_000_000     # 公開株時価
NSDQ_EQUITY     = 2_500_000     # 株主資本
HOLDERS_BASE    = 36            # 制限なし公開round-lot株主（620名は制限株で除外後）

st.set_page_config(page_title="BIOT 統合ダッシュボード", page_icon="🧭", layout="wide")
st.title("🧭 BIOT 統合ディール・ダッシュボード（v4）")
st.caption("最上位の目的は『上場して、生き残る（非解散）』。上場維持判定・CAP TABLE・トラスト・A/P・"
           "エスクロー50/50・売り圧・Rule144・回収ベース・banker fee・PIPE を統合。"
           "前提に基づく計画ツールであり株価予測ではない。最終判断は DEC・会計・弁護士の確認による。")

# ============================================================
# サイドバー入力
# ============================================================
with st.sidebar:
    st.header("入力")

    st.subheader("株価前提")
    p0    = st.slider("上場後 想定株価 P0 ($)", 1.0, 8.0, 3.25, 0.25,
                      help="この株価のとき各ブロック・ボーナスがいくらになるかを試算。$1〜$8で動かせる。")
    depth = st.slider("買い手の厚み（株価が半値になる売り株数）", 200_000, 8_000_000, 500_000, 100_000,
                      help="買いたい人がたくさん並ぶ市場ほど大きく、数人しかいない市場ほど小さい。"
                           "この株数を売り浴びせると株価が約半分になる、という目安。"
                           "BIOTは買い手が薄いので小さめ（30万〜50万）が現実的。")

    st.subheader("エスクロー 50/50 シナリオ")
    scenario = st.radio(
        "$2.8M A/P を誰が処理？",
        ["A：スポンサーが処理（BIOT有利）", "B：50/50ボーナス転用＝BIOTが負担（現提案）"],
        index=1)
    trust_to_tarek = st.checkbox("トラスト $518,872 を Tarek 側が全取り", value=True,
                                 help="ON＝A/P原資からトラストが消え、BIOTの500kだけで負担")

    st.subheader("BIOT 回収ベース（当社立替）")
    rec_choice = st.radio("回収ベース",
                          [f"Tier1 中核 ${REC_TIER1:,}",
                           f"Tier1+2 ${REC_TIER2:,}",
                           f"最大防御 ${REC_MAX:,}"], index=0)
    rec_base = {0: REC_TIER1, 1: REC_TIER2, 2: REC_MAX}[
        [f"Tier1 中核 ${REC_TIER1:,}", f"Tier1+2 ${REC_TIER2:,}", f"最大防御 ${REC_MAX:,}"].index(rec_choice)]

    st.subheader("売り圧")
    chardan_pct = st.slider("Chardan 売却 (%) ／1.6M", 0, 100, 100, 5)
    sponsor_pct = st.slider("Sponsor 裁量売却 (%) ／4.5M", 0, 100, 100, 5)
    reg_mode = st.radio("Sponsor 株の売却制約",
                        ["Rule 144 適用（年≈1.15M上限）", "resale登録で自由売却"], index=0)

    st.subheader("banker fee の扱い")
    banker_mode = st.radio("≈$5.6M（A.G.P.）",
                           ["A.G.P.が完全放棄（希薄化なし）", "Tarekが株売却で現金払い（要警戒）"], index=0)

    st.subheader("🛡️ 上場維持・PIPE 設計")
    pipe_raise = st.slider("PIPE 調達額 ($M)", 0, 50, 25, 1) * 1_000_000
    pipe_price = st.slider("PIPE 価格 ($/株)", 1.0, 8.0, 3.25, 0.25)
    pipe_holders = st.slider("PIPEで増える適格株主数", 0, 2000, 300, 50,
                             help="機関中心なら少数、公募/小口なら多数")
    register_620 = st.checkbox("620名を登録（株主数に算入を試みる）", value=False,
                               help="登録で“制限なし”を狙うが、MVUPHSには算入されず売り圧は増える（要DEC）")
    equity_pre = st.slider("BIOT 推定株主資本（PIPE前, $M）", -5, 60, 10, 1,
                           help="会計上の純資産の概算。会計士と要確定") * 1_000_000
    mm_count = st.slider("マーケットメイカー数", 0, 5, 2, 1)

# ============================================================
# 計算
# ============================================================
scen_B = scenario.startswith("B")
r144   = reg_mode.startswith("Rule 144")

# --- エスクロー 50/50 ---
biot_500k_value  = 500_000 * p0
tarek_500k_value = 500_000 * p0

ap_burden = AP_TOTAL - (0 if trust_to_tarek else TRUST)  # シナリオBでBIOTが負う額

be_biot  = ap_burden / 500_000      # BIOT 500kでA/Pを消す損益分岐
be_tarek = BONUS_TOTAL / 500_000    # Tarek 500kでボーナスを払う損益分岐

if scen_B:
    biot_shortfall   = max(0, ap_burden - biot_500k_value)
    biot_cost_unrec  = rec_base                     # 自社立替は未回収
    biot_net         = biot_500k_value - ap_burden - rec_base  # 正味（負＝損）
else:
    biot_shortfall   = 0                            # A/Pはスポンサー責任
    biot_cost_unrec  = max(0, rec_base - biot_500k_value)
    biot_net         = biot_500k_value - rec_base   # 500kで自社費用を回収し超過は取り分

tarek_bonus_surplus = tarek_500k_value - BONUS_TOTAL  # Tarekの取り分（ボーナス控除後）

# --- 売り圧・株価 ---
chardan_sold = CHARDAN * chardan_pct / 100
sp_want      = SPONSOR_DISC * sponsor_pct / 100
sponsor_sold = min(sp_want, R144_YEAR) if r144 else sp_want
banker_extra = 0
if banker_mode.startswith("Tarek"):
    # $5.6M を現金化するのに必要な株数（年144上限内で）
    need_for_banker = BANKER_FEE / max(0.05, p0)
    banker_extra = min(need_for_banker, max(0, (R144_YEAR - sponsor_sold) if r144 else need_for_banker))
total_sold   = chardan_sold + sponsor_sold + banker_extra
avg_price    = max(0.05, p0 * (1 - 0.5 * total_sold / depth))

sellable_now = PUBLIC + CHARDAN + (R144_YEAR if r144 else SPONSOR_DISC)  # 近期売却可能（概算）
years_144    = SPONSOR_DISC / R144_YEAR  # 4.5M消化年数

# --- A/P vs トラスト ---
trust_for_ap = 0 if trust_to_tarek else TRUST
ap_gap       = AP_TOTAL - trust_for_ap

# --- 上場維持メトリクス（Survival） ---
pipe_shares      = pipe_raise / max(0.25, pipe_price)
unrestricted_pub = PUBLIC + pipe_shares                 # MVUPHS算入（登録620は不算入）
mvuphs           = unrestricted_pub * p0
pub_held_shares  = PUBLIC + pipe_shares + CHARDAN        # 公開株（非関係者）
mvphs            = pub_held_shares * p0
holders          = HOLDERS_BASE + (620 if register_620 else 0) + pipe_holders
equity           = equity_pre + pipe_raise
biot_ap_pay      = (ap_burden if scen_B else 0)
cash             = TRUST + pipe_raise - biot_ap_pay
req_pipe_mvuphs  = max(0, NSDQ_MVUPHS - PUBLIC * p0)     # $25M達成に要るPIPE($)
req_holders      = max(0, NSDQ_HOLDERS - HOLDERS_BASE - (620 if register_620 else 0))

surv_metrics = [
    ("株価 (bid price)",            "≥ $1.00",        f"${p0:,.2f}",          p0 >= NSDQ_BID),
    ("MVUPHS（制限なし公開株時価）", "≥ $25M（De-SPAC）", f"${mvuphs:,.0f}",     mvuphs >= NSDQ_MVUPHS),
    ("公開株主数",                  "≥ 300名",         f"{holders:,.0f}名",    holders >= NSDQ_HOLDERS),
    ("公開株数",                    "≥ 500,000株",     f"{pub_held_shares:,.0f}株", pub_held_shares >= NSDQ_PUB_SHARES),
    ("公開株時価 (MVPHS)",          "≥ $1M",           f"${mvphs:,.0f}",       mvphs >= NSDQ_MVPHS),
    ("株主資本",                    "≥ $2.5M",         f"${equity:,.0f}",      equity >= NSDQ_EQUITY),
    ("マーケットメイカー",          "≥ 2社",           f"{mm_count}社",        mm_count >= 2),
    ("現金（運転資金）",            "> $0（健全）",     f"${cash:,.0f}",        cash > 0),
]
surv_pass = sum(1 for m in surv_metrics if m[3])

# ============================================================
# タブ
# ============================================================
tab_surv, tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs(
    ["🛡️ 上場維持判定", "📊 サマリー", "💠 エスクロー50/50", "📉 売り圧・株価",
     "🧾 A/P & トラスト", "🏦 CAP TABLE", "📐 回収ベース", "📝 注記"])

# ---------- Tab0 上場維持判定（Survival） ----------
with tab_surv:
    st.subheader("🛡️ 上場維持判定（Nasdaq Capital Market 防衛線）")
    st.caption("各メトリクスを防衛線と照合。🟢=満たす / 🔴=未達。"
               "De-SPAC合併後は MVUPHS（制限なし公開株時価）≧$25M が必須関門。")

    cc = st.columns(3)
    cc[0].metric("クリア関門", f"{surv_pass} / {len(surv_metrics)}")
    cc[1].metric("売り圧反映の株価", f"${avg_price:,.2f}",
                 "≥$1" if avg_price >= 1 else "$1割れ警戒",
                 delta_color="normal" if avg_price >= 1 else "inverse")
    cc[2].metric("MVUPHS（試算）", f"${mvuphs:,.0f}",
                 f"必要$25M {'達成' if mvuphs >= NSDQ_MVUPHS else '未達'}",
                 delta_color="normal" if mvuphs >= NSDQ_MVUPHS else "inverse")

    st.dataframe({
        "関門":   [m[0] for m in surv_metrics],
        "防衛線": [m[1] for m in surv_metrics],
        "試算":   [m[2] for m in surv_metrics],
        "判定":   ["🟢 OK" if m[3] else "🔴 未達" for m in surv_metrics],
    }, use_container_width=True, hide_index=True)

    if surv_pass == len(surv_metrics):
        st.success(f"🟢 全{len(surv_metrics)}関門クリア — この前提なら上場維持の最低線を満たす。"
                   f"（株価は売り圧次第で$1を割りうる点に注意）")
    else:
        fails = [m[0] for m in surv_metrics if not m[3]]
        st.error(f"🔴 未達 {len(surv_metrics)-surv_pass}件：{ '・'.join(fails) }。下記の手当てが必要。")

    st.divider()
    st.markdown("#### 達成に必要な手当て")
    h1, h2, h3 = st.columns(3)
    h1.metric("MVUPHS$25Mに必要なPIPE", f"${req_pipe_mvuphs:,.0f}", f"@ ${p0:,.2f}")
    h2.metric("300名に必要な追加株主", f"{req_holders:,.0f}名",
              "620登録で短縮可" if not register_620 else "620登録済")
    h3.metric("現金（トラスト＋PIPE−負担）", f"${cash:,.0f}",
              delta_color="normal" if cash > 0 else "inverse")
    st.caption("🔴 MVUPHSは“新規の本物の資金（PIPE/公募）”でしか積めない（再販登録株は不算入）＝PIPEが生存のキーストーン。"
               "620名の登録は『株主数』には効くが MVUPHS には効かず、売り圧は増える（要DEC）。"
               "株価は『買い手の厚み』が薄いと$1を割りやすい＝オーバーハング封じ込めが要。")

# ---------- Tab1 サマリー ----------
with tab1:
    st.subheader("意思決定サマリー")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("想定株価 P0", f"${p0:,.2f}", f"分岐 $5.70 {'未達' if p0 < 5.70 else '到達'}",
              delta_color="inverse" if p0 < 5.70 else "normal")
    c2.metric("BIOTの$2.8M負担", "あり（B）" if scen_B else "なし（A）",
              "スポンサーが処理" if not scen_B else "BIOTが背負う", delta_color="inverse" if scen_B else "normal")
    c3.metric("BIOTショートフォール", f"${biot_shortfall:,.0f}",
              "500kで不足" if biot_shortfall > 0 else "充足", delta_color="inverse")
    c4.metric("BIOT 正味影響", f"${biot_net:,.0f}", "＋=取り分 / −=損失",
              delta_color="normal" if biot_net >= 0 else "inverse")

    # 必要PIPE（不足＋自社費用未回収＋トラスト不足の概算）
    pipe_need = biot_shortfall + (biot_cost_unrec if scen_B else 0)
    st.metric("概算 必要PIPE（現金穴埋め）", f"${pipe_need:,.0f}")

    st.divider()
    st.markdown("### 🔭 株価の見通し（売り圧を反映した着地レンジ）")
    o1, o2, o3 = st.columns(3)
    o1.metric("入力した想定株価 P0", f"${p0:,.2f}", "あなたの仮定")
    o2.metric("売り圧反映後の推定株価", f"${avg_price:,.2f}",
              f"{(avg_price/p0-1)*100:,.0f}% vs P0", delta_color="inverse")
    o3.metric("総売却株数 / 買い手の厚み", f"{total_sold:,.0f} / {depth:,.0f}")
    st.caption("『売り圧・株価』タブの前提（Chardan・Sponsorの売却％、買い手の厚み、Rule144 or 登録）で、"
               "株価がどこに着地しうるかの目安。**予測ではなく、前提に基づく試算**。"
               "買い手の厚みを小さく（薄いフロート＝現実的）すると、推定株価は大きく下がります。")

    if scen_B and p0 < be_biot:
        st.error(f"🔴 NG水準 — シナリオBかつ株価 ${p0:,.2f} < 分岐 ${be_biot:,.2f}。"
                 f"BIOTの50万株で$2.8Mを消せず、不足 ${biot_shortfall:,.0f} がBIOT負担。"
                 f"自社立替 ${rec_base:,.0f} も未回収。スポンサー責任化＋PIPE現金決済へ。")
    elif scen_B:
        st.warning(f"🟡 シナリオB（BIOT負担）。株価は分岐を上回るが、自社立替の回収と残余リスクの帰属を要確定。")
    else:
        st.success(f"🟢 シナリオA（スポンサーが$2.8M処理）。BIOTの50万株は自社費用回収＋超過分。"
                   f"前提：各債権者release＋スポンサー補償＋非希薄化を書面で固める。")

    st.divider()
    st.markdown("**横断アラート**")
    st.markdown(
        f"- 🔴 トラスト $518,872 を Tarek が全取り：{'ON（A/P原資から消失）' if trust_to_tarek else 'OFF'}\n"
        f"- 🔴 77th Division $495k は契約上 $275k 超＝関連当事者の自己取引・規定抵触の疑い\n"
        f"- 🟡 AA Grants $150k は素性未確認（支払凍結）\n"
        f"- 🟡 banker fee：{'放棄＝希薄化なし' if banker_mode.startswith('A.G.P') else 'Tarek現金払い＝売り圧増＋BIOTへ跳ね返りリスク'}"
    )

# ---------- Tab2 エスクロー50/50 ----------
with tab2:
    st.subheader("エスクロー 100万株 の 50/50 — 株価ごとの価値")
    st.markdown(f"**今の想定株価：${p0:,.2f}**（左サイドバーで $1〜$8 に動かすと、下の数字が全部変わります）")

    cL, cR = st.columns(2)
    with cL:
        st.markdown("### 🟦 Tarek 側 50万株")
        st.metric("50万株の価値", f"${tarek_500k_value:,.0f}", f"@ ${p0:,.2f}")
        st.metric("ボーナス支払い", f"${BONUS_TOTAL:,.0f}", "固定")
        st.metric("Tarekの手取り（差引後）", f"${tarek_bonus_surplus:,.0f}",
                  delta_color="normal" if tarek_bonus_surplus >= 0 else "inverse")
        st.caption(f"分岐 ${be_tarek:,.2f}/株（低い＝楽勝）。内訳："
                   + " / ".join([f"{k} ${v:,.0f}" for k, v in BONUS_ITEMS.items()]))
    with cR:
        st.markdown("### 🟥 BIOT 側 50万株")
        st.metric("50万株の価値", f"${biot_500k_value:,.0f}", f"@ ${p0:,.2f}")
        if scen_B:
            st.metric("負う額（$2.8M A/P）", f"${ap_burden:,.0f}", "現提案")
            st.metric("差（価値−負担）", f"${biot_500k_value - ap_burden:,.0f}",
                      "不足" if biot_500k_value < ap_burden else "充足",
                      delta_color="inverse" if biot_500k_value < ap_burden else "normal")
            st.caption(f"分岐 ${be_biot:,.2f}/株（高い＝届きにくい）")
        else:
            st.metric("必要回収ベース", f"${rec_base:,.0f}", "自社立替")
            st.metric("超過（取り分）", f"${max(0, biot_500k_value - rec_base):,.0f}",
                      delta_color="normal")

    st.divider()
    st.markdown("#### 株価 $1〜$8 で、いくらになるか一覧")
    prices = [1, 2, 3, 4, 5, 6, 7, 8]
    tbl = {
        "株価": [f"${p}" for p in prices],
        "Tarek 500k 価値": [f"${500_000*p:,.0f}" for p in prices],
        "Tarek 手取り(−$845k)": [f"${500_000*p - BONUS_TOTAL:,.0f}" for p in prices],
        "BIOT 500k 価値": [f"${500_000*p:,.0f}" for p in prices],
        "BIOT 差(−$2.8M)": [f"${500_000*p - ap_burden:,.0f}" for p in prices],
        "BIOT判定": ["✅充足" if 500_000*p >= ap_burden else "🔴不足" for p in prices],
    }
    st.dataframe(tbl, use_container_width=True, hide_index=True)
    st.caption(f"前提：BIOTが$2.8Mを背負う場合の負担＝${ap_burden:,.0f}"
               f"（トラスト{'をTarekが全取り' if trust_to_tarek else '充当後'}）。"
               f"BIOTは株価 ${be_biot:,.2f} を超えないと500kで足りない／Tarekは ${be_tarek:,.2f} で楽に黒字。")

    # 価値カーブ（$1〜$8）
    xs = [1 + 0.1 * i for i in range(71)]  # 1.0〜8.0
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=xs, y=[500_000 * x for x in xs],
                             name="50万株の価値", line=dict(color="#4C78A8", width=3)))
    fig.add_hline(y=BONUS_TOTAL, line_dash="dash", line_color="#2E8B57",
                  annotation_text=f"Tarekボーナス $845k（分岐 ${be_tarek:,.2f}）",
                  annotation_position="bottom right")
    fig.add_hline(y=ap_burden, line_dash="dash", line_color="#E45756",
                  annotation_text=f"BIOT $2.8M負担（分岐 ${be_biot:,.2f}）",
                  annotation_position="top left")
    fig.add_vline(x=p0, line_dash="dot", line_color="gray",
                  annotation_text=f"今 ${p0:,.2f}")
    fig.update_layout(height=360, xaxis_title="株価 ($)", yaxis_title="USD",
                      margin=dict(l=10, r=10, t=10, b=10), legend=dict(orientation="h"))
    st.plotly_chart(fig, use_container_width=True)
    st.caption("青線＝50万株の価値。緑線($845k)を超えればTarekは黒字、赤線($2.8M)を超えればBIOTは500kで負担を消せる。"
               "青線が赤線と交わる株価が、BIOTの損益分岐($5.70)。")

# ---------- Tab3 売り圧・株価 ----------
with tab3:
    st.subheader("売り圧と株価インパクト")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("推定 平均株価", f"${avg_price:,.2f}", f"{(avg_price/p0-1)*100:,.0f}% vs P0",
              delta_color="inverse")
    c2.metric("総売却株数", f"{total_sold:,.0f}")
    c3.metric("近期売却可能（概算）", f"{sellable_now:,.0f}")
    c4.metric("Sponsor4.5M消化（144時）", f"{years_144:,.1f} 年")

    fig = go.Figure()
    rows = [
        ("Chardan（無償・即投げ）", chardan_sold, "#E24B4A"),
        ("Sponsor 裁量", sponsor_sold, "#EF9F27"),
    ]
    if banker_extra > 0:
        rows.append(("banker fee 現金化売り", banker_extra, "#9D4EDD"))
    rows.append(("Public", PUBLIC, "#888780"))
    rows.append(("（売らない）Nagano/Target/Everise/役員", ALIGNED_NOSELL, "#1D9E75"))
    for name, val, color in rows:
        fig.add_trace(go.Bar(y=["保有/売り"], x=[val], name=f"{name} ({val:,.0f})",
                             orientation="h", marker_color=color))
    fig.update_layout(barmode="stack", height=200, margin=dict(l=10, r=10, t=10, b=10),
                      xaxis_title="株数", legend=dict(orientation="h"))
    fig.add_vline(x=depth, line_dash="dot", line_color="gray",
                  annotation_text=f"市場の深さ {depth:,.0f}", annotation_position="top")
    st.plotly_chart(fig, use_container_width=True)

    if r144:
        st.info(f"Rule 144 適用：Sponsor は四半期上限 ≈{R144_QUARTER:,}株（年≈{R144_YEAR:,}）。"
                f"4.5M消化に約{years_144:,.1f}年。これがBIOTの“天然のブレーキ”。"
                f"resale登録が効力発生すると外れて一斉投げが可能になる。")
    else:
        st.error("resale登録で自由売却：144のブレーキが外れ、Sponsor 4.5M＋Chardan 1.6M の"
                 "一斉投げが可能。薄いフロートでは株価暴落リスク。登録タイミングの主導が要。")

# ---------- Tab4 A/P & トラスト ----------
with tab4:
    st.subheader("A/P $2,852,414.99 とトラスト $518,872")
    c1, c2, c3 = st.columns(3)
    c1.metric("A/P 総額", f"${AP_TOTAL:,.0f}")
    c2.metric("A/P原資のトラスト", f"${trust_for_ap:,.0f}",
              "Tarekが全取り" if trust_to_tarek else "Pubcoが充当")
    c3.metric("不足（ショートフォール）", f"${ap_gap:,.0f}", delta_color="inverse")

    fig = go.Figure()
    fig.add_trace(go.Bar(x=list(AP_CATS.keys()), y=list(AP_CATS.values()),
                         marker_color="#4C78A8",
                         text=[f"${v:,.0f}" for v in AP_CATS.values()], textposition="outside"))
    fig.update_layout(height=380, yaxis_title="USD", margin=dict(l=10, r=10, t=30, b=120))
    fig.update_xaxes(tickangle=-30)
    st.plotly_chart(fig, use_container_width=True)
    st.caption("法務が約67%、うち EGS 単独 $1,556,889（A/P全体の55%）。"
               "トラスト($518,872)では A/P($2.85M)を到底賄えず、不足はPIPE/固定価値/スポンサー責任で。")

# ---------- Tab5 CAP TABLE ----------
with tab5:
    st.subheader("CAP TABLE（28,794,472株）— 売る・売らない")
    rows = [
        ("Tomoki Nagano", NAGANO, "12mo", "売らない"),
        ("Target Stockholders", TARGET, "Nil", "売らない（アライン）"),
        ("Everise Concepts", EVERISE, "Nil", "売らない（関連当事者）"),
        ("Officer/Director/family", OFFICERS, "12mo", "売らない"),
        ("Initial (excl Sponsor)", INITIAL_EXSPON, "12mo", "ロック中"),
        ("Public Stockholders", PUBLIC, "Nil", "売却可（極小）"),
        ("Chardan", CHARDAN, "Nil", "即投げ（無償）"),
        ("Sponsor (escrow 1M+裁量4.5M)", SPONSOR, "一部制限", "4.5Mは制約次第"),
    ]
    st.dataframe(
        {"株主": [r[0] for r in rows],
         "株数": [f"{r[1]:,}" for r in rows],
         "%": [f"{r[1]/TOTAL*100:,.2f}%" for r in rows],
         "ロック": [r[2] for r in rows],
         "売却": [r[3] for r in rows]},
        use_container_width=True, hide_index=True)

    colors = ["#1D9E75","#1D9E75","#1D9E75","#1D9E75","#7Fb3d5","#888780","#E24B4A","#EF9F27"]
    fig = go.Figure(go.Pie(labels=[r[0] for r in rows], values=[r[1] for r in rows],
                           marker_colors=colors, hole=0.45, textinfo="percent"))
    fig.update_layout(height=380, margin=dict(l=10, r=10, t=10, b=10))
    st.plotly_chart(fig, use_container_width=True)
    st.success(f"🟢 売らないアライン勢 計 {ALIGNED_NOSELL:,}株（{ALIGNED_NOSELL/TOTAL*100:,.1f}%）。"
               f"即時売り圧は実質 Chardan＋Sponsor裁量 に限定。")

# ---------- Tab6 回収ベース ----------
with tab6:
    st.subheader("BIOT 立替の回収ベース（段階別）")
    tiers = [("Tier1 中核（現エスクロー・確実）", REC_TIER1),
             ("Tier1+2（＋追加Promissory Note）", REC_TIER2),
             ("最大防御（＋IPOコンサル）", REC_MAX)]
    c1, c2, c3 = st.columns(3)
    c1.metric("Tier1 中核", f"${REC_TIER1:,}", "確実")
    c2.metric("Tier1+2", f"${REC_TIER2:,}", "要振替（Trust一方のみ）")
    c3.metric("最大防御", f"${REC_MAX:,}", "要証憑・関連当事者")

    fig = go.Figure()
    fig.add_trace(go.Bar(name="回収ベース", x=[t[0] for t in tiers], y=[t[1] for t in tiers],
                         marker_color="#4C78A8"))
    fig.add_hline(y=biot_500k_value, line_dash="dot", line_color="#E45756",
                  annotation_text=f"BIOT 500k @${p0:,.2f} = ${biot_500k_value:,.0f}",
                  annotation_position="top left")
    fig.update_layout(height=340, yaxis_title="USD", margin=dict(l=10, r=10, t=10, b=80))
    fig.update_xaxes(tickangle=-15)
    st.plotly_chart(fig, use_container_width=True)
    st.caption(f"BIOTの50万株@${p0:,.2f}は ${biot_500k_value:,.0f}。"
               f"$290,791（中核）は株価$0.58超で、最大$691,240は株価$1.38超でカバー。"
               f"明細の②/③割付はDEC・会計と要確定。")

# ---------- Tab7 注記 ----------
with tab7:
    st.subheader("前提・注記")
    st.markdown(
        "- **データ基準**：CAP TABLE 28,794,472株、A/P 2026/3/31、最終トラスト $518,872（2026/3/25株主総会後）。\n"
        "- **二重回収禁止**：① 最初のPromissory Note は相殺済で除外。② はTrust返済かエスクローの一方のみ。\n"
        "- **77th Division**：契約上の事務管理費は $275k。$495kボーナスは $220k 過大＝関連当事者の自己取引・"
        "Relativity規定（関連会社への追加報酬禁止）抵触の疑い。\n"
        "- **トラスト帰属**：クロージング後は Pubco(BIOT) 帰属が原則。スポンサー全取りは文書化された正当債務の範囲のみ。\n"
        "- **Rule 144**：アフィリエイト＝四半期上限 ≈1%（年≈1.15M）。resale登録で外れる。登録タイミングの主導が株価防衛の要。\n"
        "- **banker fee ≈$5.6M**：pro formaに新株なし＝完全放棄の公算。ただし『Tarekが株売却で現金払い』なら売り圧増＋"
        "BIOTへ跳ね返りリスク。A.G.P.によるPubco免責(release)を必ず取る。\n"
        "- **株価**：未上場・極薄フロートのため実値は予測不能。本ツールは前提に基づく計画用で予測ではない。\n"
        "- **最終判断**：規制・税務・会計・法務は DEC（Darryl, Edward & Co.）および監査人の確認による。"
    )
    st.divider()
    st.markdown("##### 🛡️ 上場維持の防衛線（Nasdaq Capital Market・2026/1版）")
    st.markdown(
        "- 維持は3基準のいずれか（**株主資本$2.5M / 上場証券時価$35M / 純利益$50万**）＋ 全て"
        "（公開株50万株・公開株時価$1M・**株価$1**・**公開株主300名**・MM2社）。\n"
        "- **De-SPAC合併後は MVUPHS（制限なし公開株時価）≧ $25M が必須関門**。"
        "**再販登録株・制限株は“制限なし公開株”に算入されない**＝新規の本物の資金（PIPE/公募）が必要。\n"
        "- **620名は制限株のため公開株主・公開株の計算から除外**。除外後の適格round-lot株主は約36名（300名に大幅不足）。\n"
        "- 猶予：株価・上場証券時価・公開株時価は**180日**の是正期間。株主資本・株主数・株式数は**自動猶予なし**（是正計画の提出）。\n"
        "- 株主資本・現金は概算入力（会計士と要確定）。MM数・PIPE株主数・620登録の可否はDEC/引受人と要確認。"
    )
