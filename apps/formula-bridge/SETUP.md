# 処方ブリッジ（本格版）設定手順

Supabase（データベース・会員管理）と、公開用のサイトで動く版です。
インドネシア側は **メールアドレスとパスワードだけ** で使えます（Claude のアカウントは不要です）。

## できていること

| 項目 | 状態 |
|---|---|
| データベース（案件・依頼・提出・完成処方・企画書） | 作成済み（Supabase プロジェクト `formula-bridge`、シンガポール） |
| 会社ごとの閲覧制限（A社はB社の依頼を見られない・書き換えられない） | 作成・検証済み |
| 企業登録（会社名・担当者・連絡先・パスワード・NIB・ハラール・秘密保持同意） | 作成済み |
| マスター画面（全社の状況・依頼内容・進捗） | 作成済み |
| 依頼ボタン → 相手企業へリンク付きメール | 仕組みは作成済み。**メールサービスの設定待ち** |
| 提出 → 当社の開発専用メールへ自動通知 | 仕組みは作成済み。**メールサービスの設定待ち** |
| 翻訳・日本語表示名称への変換・企画書作成（AI） | 仕組みは作成済み。**APIキーの設定待ち** |
| 市場データ（出典付き） | 登録済み |

## 社長にお願いする作業（上から順に）

### 1. サイトを公開する（Vercel・無料）
1. https://vercel.com を開き「Sign Up」→「Continue with GitHub」でログインします。
2. 「Add New…」→「Project」→ リポジトリ `biot-simulator` の「Import」を押します。
3. 「Root Directory」の「Edit」を押し、`apps/formula-bridge/web` を選びます。
4. 「Framework Preset」は「Other」のまま、「Deploy」を押します。
5. 完成すると `https://〜.vercel.app` のURLが表示されます。これが処方ブリッジのURLです。

### 2. Supabase にサイトのURLを登録する
1. https://supabase.com/dashboard/project/hskwwaziaplysoepqxiy を開きます。
2. 左メニュー「Authentication」→「URL Configuration」を開きます。
3. 「Site URL」に手順1のURLを入れて保存します。
4. 「Redirect URLs」に `手順1のURL/**` を追加します。

### 3. AI の鍵（APIキー）を登録する
1. https://console.anthropic.com →「API Keys」→「Create Key」で鍵を作ります（`sk-ant-…` で始まる文字列）。
2. Supabase の左メニュー「Edge Functions」→「Secrets」で、名前 `ANTHROPIC_API_KEY`、値に鍵を入れて保存します。

### 4. メール送信の設定（Resend）※送信元アドレスが決まってから
1. https://resend.com に登録し、「Domains」で会社のドメインを追加します。
   表示される DNS の設定を、ドメインの管理会社の画面に貼り付けます。
2. 「API Keys」で鍵を作ります（`re_…` で始まる文字列）。
3. Supabase「Edge Functions」→「Secrets」に、名前 `RESEND_API_KEY` で登録します。
4. Supabase「Authentication」→「Emails」→「SMTP Settings」で「Enable custom SMTP」をオンにして、次を入れます。
   - Host: `smtp.resend.com`　Port: `465`　Username: `resend`　Password: 手順2の鍵
   - Sender email: `noreply@御社ドメイン`　Sender name: `Formula Bridge`
   → これで、インドネシア側の **登録確認メール** と **パスワード再設定メール** が届くようになります。

> **それはNG**：「Confirm email（メール確認）」をオフにしてはいけません。オフにすると、他人が社長のメールアドレスで先に登録して管理者になりすませてしまいます。

### 5. 社長の管理者アカウントを作る
1. 手順1のURLを開き、「Register company」から登録します（会社名欄には自社名を入れてください）。
2. メールアドレスは **tomoking47@gmail.com**（管理者として登録済みのアドレス）を使います。
3. 届いた確認メールのリンクを開くと、マスター画面が使えるようになります。
   ほかの社員を管理者にする場合は「設定」→「管理者のメールアドレス」に追加してから登録してもらいます。

### 6. 設定画面で開発専用メールを入れる
マスター画面の「設定」で次を入れて保存します。
- 開発専用メールアドレス（インドネシア側の提出がここに届きます）
- 送信元（例：`処方ブリッジ <noreply@御社ドメイン>`）
- このサイトのURL（手順1のURL）

### 7. インドネシア3社に URL を送る
手順1のURLを送り、「Register company」から登録してもらいます。
登録された会社は、マスター画面と「登録企業」に表示されます。

## 使い方の流れ
1. マスター画面 →「＋ 新規案件」→ STEP 1 で依頼内容を記入 →「依頼書を作成」
2. 依頼先の会社にチェックを入れて「依頼を送る」→ 各社にリンク付きメールが届く
3. 各社は自社あての依頼だけを開き、英語で入力して「Submit to Japan」→ 開発専用メールに通知
4. STEP 2 で各社の提出内容を比較 → STEP 3 で採用する会社を選び、当社の原料を追記して確定
5. STEP 4 の「出来上がり」→ PowerPoint・Word を保存

## 技術メモ（開発者向け）
- 画面: `web/`（ビルド不要の静的サイト。ライブラリは `web/vendor/` に同梱）
- DB: `supabase/migrations/`（行レベルセキュリティで会社ごとに分離）
- サーバー処理: `supabase/functions/ai`（Claude API、モデル `claude-opus-5`、拒否時の自動フォールバック有効）、`supabase/functions/notify`（Resend でメール送信）
