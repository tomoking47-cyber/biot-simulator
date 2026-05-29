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
import os
import json
import requests
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

# ====== IRイベント種別プリセット（過去のイベントスタディに基づく標準値）======
# 各値 = (方向, 強弱, 新規性, 重要性, 信頼度, 見通し, 出典メモ)
# スコアは 0-10。実証研究の「平均的な反応の方向・大きさ」を初期値として反映。
EVENT_PRESETS = {
    "手動（プリセットを使わない）":
        ("ポジティブ", 6, 5, 5, 6, "なし", "手動スライダーで採点する。"),
    "好業績・ガイダンス上方":
        ("ポジティブ", 6, 6, 7, 8, "上方",
         "決算サプライズは発表前後でCAR約+2〜4%、その後も同方向にドリフト（PEAD）。"),
    "臨床/FDA ポジ（承認・成功・Fast Track）":
        ("ポジティブ", 9, 8, 9, 7, "なし",
         "早期biotechは大手より day0で+8〜11%高い反応。Fast Track 5日CAR+21%（小標本）。翌日反落に注意。"),
    "臨床/FDA ネガ（失敗・CRL）":
        ("ネガティブ", 9, 8, 9, 7, "なし",
         "ネガは反応が大きく持続（非対称）。下落幅は同等の好材料の上昇より大きい傾向。"),
    "提携・大型契約":
        ("ポジティブ", 7, 7, 7, 6, "なし",
         "材料の確度・規模次第。確度が低いと期待先行→反落しやすい。"),
    "増資・希薄化（CEF/SEPA/ATM・新株）":
        ("ネガティブ", 6, 5, 6, 6, "なし",
         "米SEOは平均約−2%（小型・biotechはより悪化、COVID期−8.6%）。ただし3〜4割は逆に上昇。"),
    "M&A（当社が買い手）":
        ("ニュートラル", 5, 6, 6, 6, "なし",
         "買い手の平均反応は約0〜+1.5%。小型買い手は+2%超、大型はゼロ近辺。対象企業側は大幅プラス。"),
    "トークン/RWA・資本政策":
        ("ニュートラル", 5, 7, 5, 4, "なし",
         "確立した実証データに乏しい→信頼度低め・反落リスク高で保守的に評価。"),
    "見通し下方・悪材料":
        ("ネガティブ", 6, 5, 6, 7, "下方",
         "ガイダンス下方は売りを誘発。非対称性で下方反応は大きくなりがち。"),
    "定型・想定内開示":
        ("ニュートラル", 2, 2, 3, 6, "なし",
         "サプライズが小さい開示は平均でほぼ0%。"),
}

# ====== AI採点（Dify連携：既存の参謀と同じ作法）======
DIFY_BASE   = "https://api.dify.ai/v1"
DIFY_IR_KEY = os.environ.get("DIFY_KEY_IR", "")
try:
    if st.secrets.get("DIFY_KEY_IR"):
        DIFY_IR_KEY = st.secrets["DIFY_KEY_IR"]
except Exception:
    pass

def score_ir_with_dify(ir_text: str) -> dict:
    """IR文案をDify(IR採点アプリ)へ送り、採点JSONを受け取る。"""
    if not DIFY_IR_KEY:
        return {"ok": False, "error": "DIFY_KEY_IR が未設定。Streamlitの Settings → Secrets に追加してください。"}
    if not ir_text.strip():
        return {"ok": False, "error": "IR文案が空です。"}
    headers = {"Authorization": f"Bearer {DIFY_IR_KEY}", "Content-Type": "application/json"}
    payload = {"inputs": {}, "query": ir_text, "response_mode": "blocking", "user": "biot-ir-sim"}
    try:
        r = requests.post(f"{DIFY_BASE}/chat-messages", headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        ans = r.json().get("answer", "")
    except Exception as e:
        return {"ok": False, "error": f"Dify呼び出し失敗: {e}"}
    txt = ans.strip().replace("```json", "").replace("```", "").strip()
    try:
        i, j = txt.find("{"), txt.rfind("}")
        data = json.loads(txt[i:j + 1])
    except Exception:
        return {"ok": False, "error": "AIの返答をJSONとして解釈できませんでした。", "raw": ans}
    return {"ok": True, "data": data}

def _clamp10(v, d=5):
    try:
        return max(0, min(10, int(round(float(v)))))
    except Exception:
        return d

st.set_page_config(page_title="エスクロー シミュレーター", page_icon="💠", layout="wide")

# ====== パスワード保護（app.py と同じ biot2026）======
PASSWORD = "biot2026"
if "authenticated" not in st.session_state:
    st.session_state.authenticated = False
if not st.session_state.authenticated:
    st.title("🔒 ログイン / Login")
    pwd = st.text_input("Password / パスワード", type="password")
    if st.button("Login / ログイン"):
        if pwd == PASSWORD:
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("Wrong password / パスワードが違います")
    st.stop()

st.title("💠 エスクロー & IRインパクト シミュレーター")
st.caption("Sponsor／Chardanの売却量・想定株価から株価インパクトとエスクロー回収（残はSponsorへ返還）、"
           "ナガノ・ボーナス希薄化、さらにIR材料の採点→市場反応（買いで売り圧力を相殺）までを試算。"
           "数値は前提による計画ツールで株価予測ではない。内部シナリオ検討専用。")

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

    st.subheader("🗞️ IRインパクト（採点→反応）")
    st.caption("※種別を選ぶと過去事例の標準値で自動採点。文案からのAI自動採点はv2で接続。")
    ir_on    = st.checkbox("IRインパクトを需給に反映する", value=False,
                           help="OFFなら従来のエスクロー試算のみ")
    ir_event = st.selectbox("IRイベント種別（過去事例の標準値）", list(EVENT_PRESETS.keys()), index=1)
    _preset  = EVENT_PRESETS[ir_event]
    st.caption(f"📚 {_preset[6]}")
    use_preset = ir_event != "手動（プリセットを使わない）"

    st.markdown("**🤖 AIで採点（Dify）**")
    ir_text = st.text_area("IR文案を貼る（公開情報のみ）", height=110, key="ir_text",
                           placeholder="プレスリリース等の本文を貼り付け…")
    if st.button("AIで採点する"):
        with st.spinner("AI採点中…"):
            res = score_ir_with_dify(ir_text)
        if res.get("ok"):
            d = res["data"]
            st.session_state["ir_ai"] = {
                "dir":  d.get("direction", "ニュートラル"),
                "str":  _clamp10(d.get("strength")),
                "nov":  _clamp10(d.get("novelty")),
                "mat":  _clamp10(d.get("materiality")),
                "cred": _clamp10(d.get("credibility")),
                "guid": d.get("guidance", "なし"),
                "event": d.get("event_type", ""),
                "reason": d.get("reason", ""),
            }
            st.success("AI採点完了。下の『AI採点結果を使う』をON。")
        else:
            st.error(res.get("error", "失敗"))
            if res.get("raw"):
                st.caption(f"AI返答: {res['raw'][:300]}")
    ir_ai  = st.session_state.get("ir_ai")
    use_ai = False
    if ir_ai:
        use_ai = st.checkbox("🤖 AI採点結果を使う", value=True)
        st.caption(f"AI判定: {ir_ai.get('event','')}／{ir_ai.get('dir','')}・"
                   f"強{ir_ai['str']}/新{ir_ai['nov']}/重{ir_ai['mat']}/信{ir_ai['cred']}・"
                   f"見通し{ir_ai.get('guid','なし')}")
        if ir_ai.get("reason"):
            st.caption(f"根拠: {ir_ai['reason']}")

    with st.expander("採点を手動で微調整", expanded=not use_preset):
        ir_dir  = st.radio("材料の方向", ["ポジティブ", "ニュートラル", "ネガティブ"],
                           index=["ポジティブ", "ニュートラル", "ネガティブ"].index(_preset[0]),
                           horizontal=True)
        ir_str  = st.slider("強弱（インパクトの大きさ）", 0, 10, _preset[1], 1,
                            help="0=ノイズ, 5=通常IR, 10=治験成功・大型提携など")
        ir_nov  = st.slider("新規性（サプライズ度）", 0, 10, _preset[2], 1,
                            help="既に織り込み済みか、未知の好悪材料か")
        ir_mat  = st.slider("重要性（財務・戦略インパクト）", 0, 10, _preset[3], 1)
        ir_cred = st.slider("信頼度（データ・第三者裏付け）", 0, 10, _preset[4], 1,
                            help="低い＝プロモ的＝期待先行・反落しやすい")
        ir_guid = st.selectbox("見通し（ガイダンス）", ["なし", "上方", "中立", "下方"],
                               index=["なし", "上方", "中立", "下方"].index(_preset[5]))
    with st.expander("IR前提（調整可）"):
        ir_full = st.slider("好材料スコア1.0で入る買い (株)", 100_000, 3_000_000, 800_000, 50_000,
                            help="材料が満点級なら何株の買いが入るか、という需給前提")
        ir_adv  = st.slider("想定1日出来高 ADV (株)", 100_000, 5_000_000, 800_000, 50_000,
                            help="未上場でADV未確定。出来高試算のための前提値")
        ir_volk = st.slider("出来高スパイク係数", 0.0, 5.0, 2.0, 0.1,
                            help="新規性・規模で出来高が何倍に膨らむか")

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

# ====== IRインパクト計算（採点→反応→需給ネット）======
# 採点ソースの優先順位：AI採点 > イベント種別プリセット > 手動スライダー
if use_ai and ir_ai:
    ir_dir  = ir_ai["dir"] if ir_ai["dir"] in ("ポジティブ", "ニュートラル", "ネガティブ") else "ニュートラル"
    ir_str, ir_nov, ir_mat, ir_cred = ir_ai["str"], ir_ai["nov"], ir_ai["mat"], ir_ai["cred"]
    ir_guid = ir_ai["guid"] if ir_ai["guid"] in ("なし", "上方", "中立", "下方") else "なし"
elif use_preset:
    ir_dir, ir_str, ir_nov, ir_mat, ir_cred, ir_guid = _preset[0], _preset[1], _preset[2], _preset[3], _preset[4], _preset[5]
_dir  = {"ポジティブ": 1, "ニュートラル": 0, "ネガティブ": -1}[ir_dir]
_guid = {"なし": 0.0, "上方": 0.15, "中立": 0.0, "下方": -0.25}[ir_guid]
mag   = (ir_str * 0.40 + ir_nov * 0.35 + ir_mat * 0.25) / 10.0     # マグニチュード 0..1
cred  = ir_cred / 10.0                                             # 信頼度 0..1
S     = max(-1.0, min(1.0, _dir * mag * cred + _guid))            # ネット・センチメント -1..1
ir_flow = S * ir_full                                             # +買い / -売り (株)
ir_buy  = max(0.0, ir_flow)
ir_sell = max(0.0, -ir_flow)
ir_vol  = ir_adv * (1 + ir_volk * (ir_nov / 10.0) * mag)          # 想定出来高
ir_turn = ir_vol * avg_price                                      # 売買代金（概算）
conf    = round(100 * cred * (0.6 + 0.4 * mag))                   # 確信度 %

# 需給ネット：IRの買いで既存の売りを相殺（正=売り超 / 負=買い超）
net_sell  = total_sold - ir_buy + ir_sell
price_ir  = max(0.05, p0 * (1 - 0.5 * net_sell / depth))
dir_label = "買い優勢" if net_sell < -1 else ("売り優勢" if net_sell > 1 else "拮抗")

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

# ====== 出力：IRインパクト（採点→反応）======
st.subheader("🗞️ IRインパクト（採点 → 市場反応）")
if not ir_on:
    st.info("IRインパクトは現在OFF。サイドバーの「IRインパクトを需給に反映する」をONにすると、"
            "IR材料の採点から買い圧力を試算し、既存の売り圧力を相殺した株価を表示します。")
else:
    i1, i2, i3, i4 = st.columns(4)
    i1.metric("想定方向", dir_label, f"確信度 {conf}%")
    if ir_flow >= 0:
        i2.metric("IR起因の需給", f"買い {ir_buy:,.0f}株", f"センチメント {S:+.2f}")
    else:
        i2.metric("IR起因の需給", f"売り {ir_sell:,.0f}株", f"センチメント {S:+.2f}",
                  delta_color="inverse")
    i3.metric("想定出来高 / 代金", f"{ir_vol:,.0f}株", f"≈ ${ir_turn:,.0f}")
    i4.metric("IR反映後 株価", f"${price_ir:,.2f}",
              f"{(price_ir/avg_price-1)*100:+,.1f}% vs IR非反映")

    if _dir > 0 and cred < 0.5:
        st.warning("期待先行・反落リスク — 信頼度が低い（プロモ的）材料は短期の上げが剥落しやすい。"
                   "データ・第三者裏付けを伴う開示を。")
    if ir_guid == "下方":
        st.error("ガイダンス下方は売りを誘発。開示の時期・表現はDEC（法務）と事前確認を。")
    if net_sell < -1 and (used > 0 or tk_sh > 0 or ch_sh > 0):
        st.error("⚠️ 規制注意 — IR好反応に合わせて関係者（Sponsor／エスクロー／ナガノ）の売却を"
                 "タイミングさせると、市場操作・インサイダー類似の疑義。IR反応の試算と売却判断は分離し、"
                 "Reg FD（公平開示）と併せてDEC確認を。")

    figi = go.Figure()
    figi.add_trace(go.Bar(y=["需給"], x=[total_sold], name=f"既存の売り ({total_sold:,.0f})",
                          orientation="h", marker_color="#E24B4A"))
    figi.add_trace(go.Bar(y=["需給"], x=[-ir_buy], name=f"IRの買い ({ir_buy:,.0f})",
                          orientation="h", marker_color="#1D9E75"))
    if ir_sell > 0:
        figi.add_trace(go.Bar(y=["需給"], x=[ir_sell], name=f"IRの売り ({ir_sell:,.0f})",
                              orientation="h", marker_color="#EF9F27"))
    figi.update_layout(barmode="relative", height=160, margin=dict(l=10, r=10, t=10, b=10),
                       xaxis_title="株数（右=売り超 / 左=買い超）", legend=dict(orientation="h"))
    figi.add_vline(x=0, line_color="gray")
    st.plotly_chart(figi, use_container_width=True)
    st.caption(f"ネット需給：{dir_label} {abs(net_sell):,.0f}株 → IR反映後株価 ${price_ir:,.2f}"
               f"（IR非反映 ${avg_price:,.2f}）")

with st.expander("前提・注記"):
    st.markdown(
        "- 株価インパクトは「深さ」前提の簡易モデル。BIOT未上場でADV未確定のため予測ではない。\n"
        "- エスクローの未使用分は **Sponsorへ返還**。回収ベースを実費の範囲で上げるほど返還は縮む。\n"
        "- Rule 144 はSponsorがアフィリエイト＆未登録の場合の天然ブレーキ。登録状況はDEC確認。\n"
        "- ボーナス発行は **Chardan受領後**。反希薄化条件・関連当事者開示・個人課税に留意。\n"
        "- 二重回収禁止：① Promissory Note は相殺済で除外、② はTrustかエスクローの一方のみ。\n"
        "- **IRインパクトはAI採点（強弱／新規性／重要性／信頼度／見通し）→ 反応への簡易変換**。"
        "変換係数はすべて前提（調整可）。未上場でADV未確定のため、出来高・株価は予測ではない。\n"
        "- **規制（重大度：高）**：IR反応の試算と関係者の売却判断は分離する。予測上昇に合わせた"
        "Sponsor／エスクロー／ナガノの売却タイミングは市場操作・インサイダー類似の疑義。"
        "Reg FD（公平開示）と併せDEC（法務）レビュー必須。"
    )
