# 処方ブリッジ → BIOT OS 連携 指示書（化粧品開発スケジュール）

- 作成：2026-11-17、処方ブリッジ担当の Claude（会長指示「全てを終わらせろ」）
- 正本：GitHub `tomoking47-cyber/biot-simulator` の `apps/formula-bridge/BIOTOS_LINK.md`。G の `BIOTOS_統合OS_バックアップ/システム台帳/処方ブリッジ_BIOTOS連携_指示書.md` は同じ内容の控え（上書きで更新する）。
- 読む人：統合OS（GitHub `yujinaito/biotos-ap`、本番 https://biotos-ap.pages.dev/app/）を直している Claude（Mac）または Codex。
- システム台帳へ追記してください：「処方ブリッジ（Supabase：tomoking47-cyber's Org の formula-bridge）に、BIOT OS 向けの読み取り専用の受け渡し口 biotos-feed を追加（2026-11-17）」。

## 1. 何ができたか（処方ブリッジ側は完了・本番反映済み）

| 項目 | 状態 |
|---|---|
| 案件の STEP 1 に「開発スケジュールの商品（BIOT OS）」「発売目標月」を追加 | 本番反映済み。日本側だけが見られる（仕入先には出ない） |
| 受け渡し口 `biotos-feed`（読むだけ） | 本番で稼働中。合言葉が未設定のため、今は閉じている（503） |
| 設定画面「BIOT OS との連携」 | 管理者が、BIOT OS に渡す内容と接続状態を確認できる |

商品の一覧は G の「２０２６年 化粧品スケジュール」の行（Genrever、Hakua マスク／美容液／化粧水／クリーム／香水、Hakua nagi（鎮静）、Genrever000／001、Genreverシャンプー／トリートメント、GenreverPRO001、ハル シリーズ、Vivea、シゲ香水、リップ、LUNANOX 50ml／5ml、ヘアバーム、アズール、パルファム 5ml／50ml、ミスト、オールインワン、REJU、Amazon クリーム／美容液／ヘアバーム／香水／その他、Miamyu、Manorol）。一覧に無い名前も入力できる。

## 2. BIOT OS 側でやること

### 2-1. 合言葉を決めて、両側に置く（値はどこにも書かない）
1. 32文字以上のランダムな文字列を作る（例：`openssl rand -hex 32`）。
2. 処方ブリッジ側：Supabase（tomoking47-cyber's Org → formula-bridge、project `hskwwaziaplysoepqxiy`）→ Edge Functions → Secrets に `BIOTOS_FEED_TOKEN` として保存。
3. BIOT OS 側：Cloudflare Pages（biotos-ap）の環境変数（Secret）に同じ値を保存（例：`FORMULA_BRIDGE_FEED_TOKEN`）。
4. 台帳・G・GitHub・チャットには値を書かない（台帳の決まり5）。

### 2-2. 読み取り
```
GET https://hskwwaziaplysoepqxiy.supabase.co/functions/v1/biotos-feed
x-biotos-token: <合言葉>
```
- 200：下の JSON。401：合言葉が違う。503：処方ブリッジ側に合言葉が未設定。
- ブラウザから直接呼ばない（合言葉が見えてしまう）。Pages Functions などサーバー側で読み、画面へ渡す。
- 1日数回〜画面を開いた時に読む程度でよい（読むだけで、処方ブリッジのデータは変わらない）。

### 2-3. JSON の形（`//` 以降は説明。実際の JSON には入らない）
```json
{
  "source": "formula-bridge",
  "generated_at": "2026-11-17T10:00:00Z",
  "projects": [{
    "id": "uuid", "name": "案件名",
    "schedule_item": "Hakua マスク",        // スケジュールのどの行か。未入力は null →「未分類」に載せる
    "target_month": "2027-03",              // 発売目標月。未入力は null
    "category": "マスク", "requester": "長野", "markets": ["jp","id"],
    "stage": "requested", "stage_ja": "仕入先が開発中",
    "milestones": { "created": "...", "requested": "...", "first_submitted": "...", "all_submitted": "...",
                    "first_sample_shipped": "...", "feedback_done": "...", "adopted": "...", "finalized": "...", "plan_created": "..." },
    "last_activity": "...",
    "suppliers": [{ "company": "PT MAHA KIMIA INDONESIA", "status": "submitted", "requested_at": "...", "submitted_at": "...",
                    "shipped_at": "...", "feedback_at": "...", "decision": "採用（本処方は当社に帰属）", "outcome": "採用" }],
    "adopted_company": "PT MAHA KIMIA INDONESIA",
    "final": { "product_name": "...", "brand": "...", "launch": "...", "channel": "...",
               "ingredients": [{ "label_name_ja": "水", "inci": "Water", "percent": 80, "purpose": "基剤", "source": "ベース" }] },
    "url": "https://formula-bridge-eight.vercel.app/#/p/<id>/req"
  }]
}
```
- `stage` の順番：draft（依頼準備中）→ requested（仕入先が開発中）→ submitted（提出あり・確認中）→ feedback（フィードバック済み）→ adopted（採用決定）→ finalized（完成処方確定）→ plan（企画書作成済み）。
- 日付はすべて ISO 8601（UTC）。無いものは null。
- 入らないもの：希望原料費・完成品コスト・販売価格・仕入先の原料見積・連絡先・添付ファイル。
- `final.ingredients`（配合量つきの完成処方）は社外秘。BIOT OS では会長・役員など見られる人を絞って表示する。

### 2-4. 画面（化粧品開発スケジュール）
1. スケジュールの行（商品）ごとに、`schedule_item` が一致する案件を並べる。一致しない・未入力は「未分類（処方ブリッジ）」の行へ。
2. 各案件は `milestones` の日付を月の欄に置き、`stage_ja` を表示。`target_month` があれば発売目標として印を付ける。
3. 案件名は `url` へのリンク（処方ブリッジの画面が開く。日本側の管理者だけが入れる）。
4. 処方ブリッジ側で何かを書き込む操作は作らない（一方向）。

## 3. 確認のしかた
1. 処方ブリッジの「設定」→「BIOT OS との連携」→「BIOT OS に渡す内容を確認する」で「接続：設定済み ✓」になること。
2. BIOT OS 側から読んで 200 が返り、案件数が 1 の画面と一致すること。
3. 合言葉を変えるときは、両側を同時に変える。

## 4. 処方ブリッジ側の検証記録
- 受け渡し口の単体テスト 18 項目を 2 回実行、すべて合格（合言葉なし・違う合言葉・未設定・管理者の確認・仕入先の拒否、段階と日付の計算、金額が一切含まれないこと）。
- 本番で、資格情報なし → 401、合言葉未設定 → 503 を確認。
- 画面のテスト 52 項目（PC・スマホ、日本側・仕入先、新しい2項目の保存と仕入先に出ないこと、設定画面の確認表示）を 2 回実行、すべて合格。
