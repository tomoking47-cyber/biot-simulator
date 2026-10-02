# Run: python3 tools/build_guide.py  (then make the PDFs from the pages; see SETUP.md)
# Builds web/guide/supplier.html (ID / EN / JA) and web/guide/japan.html (JA) from the content below.
import html, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "guide") + os.sep
URL = "https://formula-bridge-eight.vercel.app"
e = html.escape

# ---------------------------------------------------------------- supplier guide (3 languages)
# Each step: (anchor, {id,en,ja} title, image or None, [ {id,en,ja} bullet ], optional {id,en,ja} tip)
S = [
("login", {"id": "Undangan dan masuk", "en": "Invitation and sign-in", "ja": "招待メールとログイン"}, "01-login", [
 {"id": "Anda akan menerima email undangan dari Artisans Production. Tekan tombol “Sign in to Formula Bridge / Masuk ke Formula Bridge” di email tersebut — Anda langsung masuk, tanpa kata sandi sementara.", "en": "You will receive an invitation email from Artisans Production. Press “Sign in to Formula Bridge / Masuk ke Formula Bridge” in the email — you are signed in directly, no temporary password needed.", "ja": "Artisans Production から招待メールが届きます。メールの「Sign in to Formula Bridge / Masuk ke Formula Bridge」ボタンを押すと、そのままログインできます（仮パスワードは不要です）。"},
 {"id": f"Setelah itu, masuk di {URL} dengan email dan kata sandi yang Anda buat sendiri (langkah 03), lalu tekan “Sign in / Masuk / ログイン”.", "en": f"After that, sign in at {URL} with your email and the password you set yourself (step 03), then press “Sign in / Masuk / ログイン”.", "ja": f"2回目からは {URL} を開き、メールアドレスと自分で決めたパスワード（手順03）を入れて「Sign in / Masuk / ログイン」を押します。"},
 {"id": "Tombol di email hanya berlaku satu kali dan untuk waktu terbatas. Lupa kata sandi atau tombol tidak berfungsi? Tekan “Forgot password? / Lupa kata sandi?” di layar masuk dan masukkan email Anda — tautan masuk baru akan dikirim.", "en": "The button in the email works once, for a limited time. Forgot your password, or the button no longer works? Press “Forgot password? / Lupa kata sandi?” on the sign-in page and enter your email — a new sign-in link is sent.", "ja": "メールのボタンは1回だけ・期限付きで有効です。パスワードを忘れた、またはボタンが使えないときは、ログイン画面の「Forgot password? / Lupa kata sandi?」でメールアドレスを入れると、新しいログイン用リンクが届きます。"},
]),
("agree", {"id": "Menyetujui 3 perjanjian (hanya sekali)", "en": "Agree to the 3 agreements (once only)", "ja": "3つの合意書に同意する（初回のみ）"}, "02-agreements", [
 {"id": "Saat pertama kali masuk, tiga perjanjian ditampilkan: Perjanjian Kerahasiaan (NDA), Pernyataan Pembelian Bahan Baku, dan Kepemilikan Formula yang Diadopsi.", "en": "The first time you sign in, three agreements are shown: the Confidentiality Agreement (NDA), the Declaration of Raw Material Purchase, and the Ownership of Adopted Formulas.", "ja": "初めてログインすると、3つの合意書（秘密保持契約・原料購入に関する宣言・採用処方の帰属）が表示されます。"},
 {"id": "Tekan “English” atau “Bahasa Indonesia” untuk mengganti bahasa.", "en": "Press “English” or “Bahasa Indonesia” to switch the language.", "ja": "「English」「Bahasa Indonesia」で言語を切り替えて読めます。"},
 {"id": "Centang ketiga kotak, lalu tekan “Agree and continue / Setuju dan lanjutkan”.", "en": "Tick all three boxes, then press “Agree and continue / Setuju dan lanjutkan”.", "ja": "3つすべてにチェックを入れ、「Agree and continue / Setuju dan lanjutkan」を押します。"},
]),
("setup", {"id": "Pengaturan awal: kata sandi dan profil perusahaan", "en": "First-time setup: password and company profile", "ja": "初回設定：パスワードと会社情報"}, "03-first-setup", [
 {"id": "Buat kata sandi Anda sendiri (minimal 10 karakter, berisi huruf dan angka) dan ketik dua kali.", "en": "Choose your own password (at least 10 characters, including letters and numbers) and type it twice.", "ja": "自分のパスワード（10文字以上、英字と数字の両方を含む）を決め、確認のため2回入力します。"},
 {"id": "Isi profil perusahaan: telepon, alamat, NIB, sertifikasi halal (tulis “Tidak ada” jika tidak ada), dan bahan baku utama.", "en": "Fill in the company profile: phone, address, NIB, halal certification (write “None” if none) and your main raw materials.", "ja": "会社情報（電話・住所・NIB・ハラール認証（なければ「None」）・主な取扱原料）を入力します。"},
 {"id": "Unggah logo perusahaan (JPG atau PNG). Jepang menggunakannya untuk membedakan pemasok.", "en": "Upload your company logo (JPG or PNG). Japan uses it to tell suppliers apart.", "ja": "会社ロゴ（JPGまたはPNG）を登録します。日本側で会社を見分けるのに使います。"},
 {"id": "Tekan “Save and continue / Simpan dan lanjutkan”. Langkah ini hanya sekali.", "en": "Press “Save and continue / Simpan dan lanjutkan”. You only do this once.", "ja": "「Save and continue / Simpan dan lanjutkan」を押します。この手順は1回だけです。"},
]),
("requests", {"id": "Membuka permintaan dari Jepang", "en": "Open a request from Japan", "ja": "日本からの依頼を開く"}, "04-requests", [
 {"id": "Saat Jepang mengirim permintaan baru, Anda menerima email. Tautan di email membuka permintaan tersebut.", "en": "When Japan sends a new request, you receive an email. The link in the email opens the request.", "ja": "日本から新しい依頼が届くとメールが来ます。メールのリンクから依頼を開けます。"},
 {"id": "Anda juga dapat membukanya dari menu “Requests / Permintaan” → tombol “Open / Buka”.", "en": "You can also open it from the “Requests / Permintaan” menu → “Open / Buka”.", "ja": "メニューの「Requests / Permintaan」→「Open / Buka」からも開けます。"},
 {"id": "Hanya perusahaan Anda yang dapat melihat permintaan ini.", "en": "Only your company can see these requests.", "ja": "依頼は自社の分だけが表示され、他社からは見えません。"},
]),
("brief", {"id": "Membaca isi permintaan", "en": "Read the request", "ja": "依頼内容を読む"}, "07-request", [
 {"id": "Bagian atas halaman berisi permintaan dari Jepang (konsep, target biaya, jadwal, dll.).", "en": "The top of the page shows Japan's request (concept, target costs, schedule, etc.).", "ja": "ページの上部に、日本からの依頼内容（コンセプト・目標原価・スケジュールなど）があります。"},
 {"id": "Tekan “English” atau “Bahasa Indonesia” untuk mengganti bahasa.", "en": "Press “English” or “Bahasa Indonesia” to switch the language.", "ja": "「English」「Bahasa Indonesia」で言語を切り替えられます。"},
]),
("a", {"id": "A. Ringkasan produk", "en": "A. Product overview", "ja": "A. 製品の概要"}, "08-a-product", [
 {"id": "Harap tulis dalam bahasa Inggris.", "en": "Please write in English.", "ja": "入力は英語でお願いします。"},
 {"id": "Isi nama produk (wajib), konsep, fitur, pH, viskositas, masa simpan, penawaran biaya bahan baku per unit, MOQ, dll.", "en": "Fill in the product name (required), concept, features, pH, viscosity, shelf life, your quote, MOQ, etc.", "ja": "製品名（必須）・コンセプト・特長・pH・粘度・使用期限・見積（原料費）・最小発注量などを入力します。"},
 {"id": "Perubahan tersimpan otomatis. Anda dapat berhenti dan melanjutkan kapan saja.", "en": "Changes are saved automatically. You can stop and continue at any time.", "ja": "入力は自動で保存されます。途中でやめて、あとから続けられます。"},
]),
("b", {"id": "B. Formula dasar", "en": "B. Base formula", "ja": "B. 処方（ベース処方）"}, "09-b-formula", [
 {"id": "Cara termudah: ① tekan “Formula template (Excel) / Template formula”, isi semua sel, lalu ② letakkan file di kotak bergaris putus-putus.", "en": "Easiest: ① press “Formula template (Excel) / Template formula”, fill in every cell, then ② drop the file in the dashed box.", "ja": "一番簡単な方法：①「Formula template (Excel)」でひな形をダウンロードしてすべて記入し、②点線の枠にファイルを入れます。"},
 {"id": "File Excel, PDF, CSV, atau foto (JPG/PNG/WEBP) dengan format Anda sendiri juga boleh (maks. 10 MB). Tabel akan terisi otomatis. Periksa isinya, lalu tekan “Use these rows / Gunakan baris ini”.", "en": "An Excel, PDF, CSV file or a photo (JPG/PNG/WEBP) in your own format also works (max 10 MB). The table is filled in automatically. Check it, then press “Use these rows / Gunakan baris ini”.", "ja": "自社形式のExcel・PDF・CSV・写真（JPG/PNG/WEBP）でも読み取れます（10MBまで）。表に自動で入るので、内容を確認して「Use these rows / Gunakan baris ini」を押します。"},
 {"id": "Isi semua sel kosong (berwarna kuning). Total harus 100%. Jika Anda memilih g atau mL per batch di “Amount unit / Satuan jumlah”, % dihitung otomatis.", "en": "Fill in any empty (yellow) cells. The total must be 100%. If you choose g or mL per batch in “Amount unit / Satuan jumlah”, % is calculated automatically.", "ja": "空欄（黄色）はすべて埋めます。合計は100%にします。「Amount unit / Satuan jumlah」で g・mL を選ぶと、% は自動計算されます。"},
 {"id": "Terakhir, tekan “Convert to Japanese names / Konversi ke nama Jepang” (1–3 menit). Nama Jepang diisi otomatis dan diperiksa oleh Jepang. Jika terlewat, konversi dilakukan otomatis saat mengirim.", "en": "Finally, press “Convert to Japanese names / Konversi ke nama Jepang” (1–3 minutes). The Japanese names are filled in automatically, and Japan checks them. If you skip this, it runs automatically when you submit.", "ja": "最後に「Convert to Japanese names / Konversi ke nama Jepang」を押すと、日本語の表示名称が自動で入ります（1〜3分。日本側で確認します）。押し忘れても、提出時に自動で変換されます。"},
], {"id": "Anda juga dapat mengetik atau menempelkan langsung di tabel dan menambah baris dengan “＋ Add row / Tambah baris”.", "en": "You can also type or paste directly into the table and add rows with “＋ Add row / Tambah baris”.", "ja": "表に直接入力・貼り付けもできます。行は「＋ Add row / Tambah baris」で追加します。"}),
("cd", {"id": "C. Keunggulan bahan baku · D. Data uji pihak ketiga", "en": "C. Raw material highlights · D. Third-party test data", "ja": "C. 原料の特長 ・ D. 第三者機関の試験データ"}, "10-c-materials", [
 {"id": "C: keunggulan bahan baku utama dan data pendukung (efikasi, mekanisme, dosis).", "en": "C: features of key raw materials and supporting data (efficacy, mechanism, dosage).", "ja": "C：主要原料の特長と裏付けデータ（効果・作用・推奨配合量）を書きます。"},
 {"id": "D: uji oleh laboratorium independen (uji tempel, efikasi, stabilitas, mikrobiologi…).", "en": "D: tests by independent laboratories (patch test, efficacy, stability, microbiology…).", "ja": "D：第三者機関の試験（パッチテスト・有効性・安定性・微生物など）を書きます。"},
 {"id": "Punya data bahan baku atau laporan uji dalam bentuk file? Seret dan letakkan (drag & drop) file tersebut apa adanya ke kotak bergaris putus-putus di C atau D. Beberapa file sekaligus boleh (maks. 25 MB per file).", "en": "Have raw material data or test reports as files? Drag and drop them as they are onto the dashed box in C or D. Several files at once is fine (max 25 MB each).", "ja": "原料資料や試験データのファイルは、C・D の点線の枠に、そのままドラッグ＆ドロップで入れられます（複数まとめて可・1ファイル25MBまで）。"},
 {"id": "File yang diletakkan di C disimpan sebagai “Raw material data”, di D sebagai “Third-party report”. Semua file terlihat di E. Lampiran.", "en": "Files dropped in C are saved as “Raw material data”, in D as “Third-party report”. All files appear in E. Attachments.", "ja": "C に入れたファイルは「Raw material data（原料資料）」、D は「Third-party report（第三者機関の報告書）」として保存され、E の一覧にまとめて表示されます。"},
]),
("e", {"id": "E. Lampiran", "en": "E. Attachments", "ja": "E. 添付ファイル"}, "12-e-files", [
 {"id": "Cara termudah: seret dan letakkan file lain (SDS, COA, spesifikasi, grafik, materi penjualan…) ke kotak bergaris putus-putus. Jenisnya ditentukan otomatis dari nama file.", "en": "Easiest: drag and drop other files (SDS, COA, specifications, graphs, sales materials…) onto the dashed box. The type is set automatically from the file name.", "ja": "一番簡単な方法：その他の資料（SDS・COA・規格書・グラフ・販促資料など）を点線の枠にドラッグ＆ドロップします。種類はファイル名から自動で判定されます。"},
 {"id": "Atau pilih kategori, tulis keterangan singkat, lalu tekan “Upload file / Unggah file”.", "en": "Or choose a category, write a short description, then press “Upload file / Unggah file”.", "ja": "または、種類を選んで説明を書き、「Upload file / Unggah file」を押します。"},
 {"id": "File yang salah dapat dihapus dengan tombol × di daftar.", "en": "Remove a wrong file with the × button in the list.", "ja": "間違えたファイルは、一覧の × で削除できます。"},
 {"id": "Contoh: lembar data, grafik, spesifikasi, SDS, COA, laporan uji (maks. 25 MB per file).", "en": "Examples: data sheets, graphs, specifications, SDS, COA, test reports (max 25 MB each).", "ja": "例：データシート・グラフ・規格書・SDS・COA・試験報告書（1ファイル25MBまで）。"},
]),
("submit", {"id": "Kirim ke Jepang", "en": "Submit to Japan", "ja": "日本へ提出する"}, "13-submit", [
 {"id": "Setelah sampel siap dan bagian A–E lengkap, tekan “Submit to Japan / Kirim ke Jepang”, lalu “Yes, submit / Ya, kirim”.", "en": "When the sample is ready and A–E are complete, press “Submit to Japan / Kirim ke Jepang”, then “Yes, submit / Ya, kirim”.", "ja": "サンプルの準備ができ、A〜E がそろったら「Submit to Japan / Kirim ke Jepang」を押し、確認画面で「Yes, submit / Ya, kirim」を押します。"},
 {"id": "Syarat: nama produk terisi, total formula 100%, dan tidak ada sel kosong. Jika ada yang kurang, layar akan memberi tahu.", "en": "Required: a product name, a formula total of 100%, and no empty cells. The screen tells you if something is missing.", "ja": "条件：製品名があること、処方の合計が100%、空欄がないこと。足りないときは画面に表示されます。"},
 {"id": "Formula otomatis dikirim ke Jepang dalam format Excel dan PDF. Anda masih dapat memperbaiki halaman sampai Jepang mengadopsi formula.", "en": "The formula is sent to Japan as Excel and PDF automatically. You can still correct the page until Japan adopts a formula.", "ja": "処方はExcelとPDFで日本に自動送信されます。日本側が処方を採用するまでは修正できます。"},
]),
("ship", {"id": "F. Pengiriman sampel", "en": "F. Sample shipment", "ja": "F. サンプルの発送"}, "14-f-shipment", [
 {"id": "Setelah menekan “Submit to Japan / Kirim ke Jepang” (langkah sebelumnya), kirim sampel ke Jepang, lalu isi kurir, nomor resi (wajib), tanggal kirim, dan jumlah sampel.", "en": "After submitting (previous step), send the sample to Japan, then enter the courier, tracking number (required), ship date and number of samples.", "ja": "提出（前の手順）が済んだら、サンプルを日本へ発送し、運送会社・追跡番号（必須）・発送日・数量を入力します。"},
 {"id": "Tekan “Shipment complete / Pengiriman selesai”, lalu “Yes, report / Ya, laporkan”. Tim Jepang menerima email otomatis.", "en": "Press “Shipment complete / Pengiriman selesai”, then “Yes, report / Ya, laporkan”. Japan's team is emailed automatically.", "ja": "「Shipment complete / Pengiriman selesai」→ 確認画面で「Yes, report / Ya, laporkan」を押すと、日本側に自動でメールが届きます。"},
]),
("feedback", {"id": "Umpan balik dari Jepang", "en": "Feedback from Japan", "ja": "日本からのフィードバック"}, "06-feedback", [
 {"id": "Setelah menilai sampel, Jepang mengirim umpan balik dalam bahasa Inggris dan Indonesia. Anda menerima email, dan umpan balik muncul di bagian atas halaman permintaan.", "en": "After evaluating the sample, Japan sends feedback in English and Indonesian. You receive an email, and it appears at the top of the request page.", "ja": "日本側がサンプルを評価すると、英語とインドネシア語でフィードバックが届きます。メールが来て、依頼ページの一番上に表示されます。"},
 {"id": "Keputusan: “Candidate for adoption / Kandidat untuk diadopsi”, “Please revise and send a new sample / Mohon lakukan revisi dan kirimkan sampel baru”, “Not adopted this time / Tidak diadopsi kali ini”, atau “Adopted / Diadopsi”. “Adopted / Diadopsi” berarti formula menjadi milik Artisans Production (perjanjian Kepemilikan Formula yang Diadopsi) dan tidak dapat diubah lagi.", "en": "Decisions: “Candidate for adoption”, “Please revise and send a new sample”, “Not adopted this time”, or “Adopted”. “Adopted” means the formula now belongs to Artisans Production (Ownership of Adopted Formulas agreement) and can no longer be changed.", "ja": "判定は「Candidate for adoption（採用候補）」「Please revise and send a new sample（再試作を依頼）」「Not adopted this time（不採用）」「Adopted（採用）」のいずれかです。「Adopted」の場合、処方は合意書（採用処方の帰属）に基づき Artisans Production のものとなり、以後は変更できません。"},
 {"id": "Jika diminta revisi: perbaiki halaman, tekan “Submit to Japan / Kirim ke Jepang” lagi, kirim sampel baru, lalu isi nomor resi yang baru dan tekan “Shipment complete / Pengiriman selesai” lagi.", "en": "If a revision is requested: correct the page, press “Submit to Japan / Kirim ke Jepang” again, send a new sample, then enter the new tracking number and press “Shipment complete / Pengiriman selesai” again.", "ja": "再試作の依頼なら、ページを修正して再度「Submit to Japan / Kirim ke Jepang」を押し、新しいサンプルを送って、新しい追跡番号を入れて「Shipment complete / Pengiriman selesai」をもう一度押します。"},
]),
("menus", {"id": "Menu lainnya", "en": "Other menus", "ja": "そのほかのメニュー"}, "15-company", [
 {"id": "“Company / Perusahaan”: ubah telepon, alamat, logo, dll., lalu tekan “Save / Simpan”. Untuk mengubah nama perusahaan atau email kontak, hubungi Artisans Production.", "en": "“Company / Perusahaan”: update phone, address, logo, etc., then press “Save / Simpan”. To change the company name or contact email, contact Artisans Production.", "ja": "「Company / Perusahaan」：電話・住所・ロゴなどを変更し、「Save / Simpan」を押します。会社名と連絡先メールの変更は Artisans Production に連絡してください。"},
 {"id": "“Translate / Terjemahkan”: menerjemahkan antara bahasa Jepang dan bahasa Indonesia.", "en": "“Translate / Terjemahkan”: translates between Japanese and Indonesian.", "ja": "「Translate / Terjemahkan」：日本語とインドネシア語を相互に翻訳できます。"},
 {"id": "“Company / Perusahaan” → “Team / Tim”: daftar rekan yang dapat masuk. Perwakilan perusahaan dapat menambah rekan (email undangan dikirim otomatis) dan menghapusnya. Semua anggota tim melihat semua permintaan untuk perusahaan Anda.", "en": "“Company / Perusahaan” → “Team / Tim”: the colleagues who can sign in. Your company's representative can add colleagues (an invitation email is sent automatically) and remove them. Everyone in the team sees all requests sent to your company.", "ja": "「Company / Perusahaan」→「Team / Tim」：ログインできる同僚の一覧です。代表者は同僚を追加（招待メールが自動で届きます）・削除できます。同じ会社の全員が、自社あての依頼をすべて見られます（他社の情報は見えません）。"},
 {"id": "“Password / Kata sandi”: ganti kata sandi Anda.", "en": "“Password / Kata sandi”: change your password.", "ja": "「Password / Kata sandi」：パスワードを変更できます。"},
]),
]

TIPS = [
 {"id": "Semua informasi di aplikasi ini bersifat rahasia (NDA). Jangan bagikan akun Anda.", "en": "Everything in this app is confidential (NDA). Do not share your account.", "ja": "アプリ内の情報はすべて秘密情報（NDA）です。アカウントを他人と共有しないでください。"},
 {"id": "Aplikasi dapat digunakan di ponsel, tetapi komputer lebih mudah untuk mengisi tabel formula.", "en": "The app works on phones, but a computer is easier for the formula table.", "ja": "スマートフォンでも使えますが、処方の表はパソコンの方が入力しやすいです。"},
 {"id": "Jika ada masalah, kirim tangkapan layar kepada perwakilan Anda di Jepang.", "en": "If something goes wrong, send a screenshot to your representative in Japan.", "ja": "困ったときは、画面の写真を日本の担当者に送ってください。"},
]

FLOW = [
 ({"id": "Jepang mengirim permintaan", "en": "Japan sends a request", "ja": "日本が依頼を送る"}, "jp"),
 ({"id": "Anda mengisi A–E", "en": "You fill in A–E", "ja": "仕入先が A〜E を入力"}, "id"),
 ({"id": "Kirim ke Jepang", "en": "Submit to Japan", "ja": "日本へ提出"}, "id"),
 ({"id": "Kirim sampel (F)", "en": "Ship the sample (F)", "ja": "サンプル発送（F）"}, "id"),
 ({"id": "Jepang mengirim umpan balik", "en": "Japan sends feedback", "ja": "日本がフィードバック"}, "jp"),
]

CSS = """
:root{color-scheme:light;--ground:#F6F2EA;--paper:#FFFDF9;--ink:#1E1C19;--ink-2:#57524A;--ink-3:#6E685E;--line:#E2DACB;--gold:#A4854B;--gold-ink:#76602F;--gold-soft:#F3ECDD;--ok:#3F5F4B;--red:#CE1126}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"Jost","Noto Sans JP","Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.6}
.wrap{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
header{border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px}
.brand{font-family:"Cormorant Garamond",serif;font-weight:600;letter-spacing:.3em;font-size:18px;border-left:1px solid var(--gold);padding-left:14px}
h1{font-family:"Cormorant Garamond","Shippori Mincho",serif;font-weight:600;font-size:30px;line-height:1.25;margin:10px 0 4px}
h1 small{display:block;font-size:18px;color:var(--ink-2);font-weight:500}
.meta{color:var(--ink-3);font-size:13px;margin:6px 0 0}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.bar a{display:inline-block;background:var(--ink);color:#fff;text-decoration:none;padding:9px 16px;border-radius:2px;font-size:14px;letter-spacing:.04em}
.bar a.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:18px 0 8px;padding:0;list-style:none}
.flow li{background:var(--paper);border:1px solid var(--line);border-top:4px solid var(--red);border-radius:2px;padding:10px 10px 12px;font-size:13px;line-height:1.45}
.flow li.jp{border-top-color:#BC002D;background:#fff}
.flow b{display:block;font-size:12px;color:var(--gold-ink);letter-spacing:.08em;margin-bottom:4px}
.flow span{display:block}.flow span+span{color:var(--ink-2)}
.toc{columns:2;column-gap:28px;margin:18px 0 0;padding-left:20px;font-size:14px}
.toc a{color:var(--ink)}
section.step{background:var(--paper);border:1px solid var(--line);border-radius:2px;padding:20px 20px 22px;margin:18px 0;break-inside:avoid-page}
.step h2{display:flex;gap:12px;align-items:baseline;margin:0 0 12px;font-weight:500;font-size:19px;line-height:1.35}
.step h2 .n{flex:none;font-family:"IBM Plex Mono",monospace;font-size:13px;color:#fff;background:var(--gold-ink);border-radius:2px;padding:2px 8px}
.step h2 .t span{display:block}.step h2 .t span+span{font-size:15px;color:var(--ink-2)}
.shot{display:block;max-width:100%;max-height:560px;margin:4px 0 14px;border:1px solid var(--line);border-radius:2px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.langs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.lang h3{margin:0 0 6px;font-size:12px;letter-spacing:.12em;color:var(--ink-3);font-weight:500;border-bottom:1px solid var(--line);padding-bottom:4px}
.lang ol{margin:0;padding-left:18px}.lang li{margin:0 0 6px;font-size:14px}
.lang.ja{font-family:"Noto Sans JP",sans-serif}
.tip{margin:10px 0 0;background:var(--gold-soft);border-radius:2px;padding:8px 12px;font-size:13.5px}
.tip span{display:block}
.flag{display:inline-block;width:1.4em;height:.95em;border-radius:2px;box-shadow:0 0 0 1px var(--line);vertical-align:-.1em;margin-right:.35em}
.flag.id{background:linear-gradient(#CE1126 50%,#fff 50%)}
.flag.jp{background:#fff radial-gradient(circle,#BC002D 0 28%,transparent 30%)}
.flag.en{width:auto;height:auto;padding:0 4px;font-style:normal;font-size:12px;line-height:1.4;letter-spacing:.06em;color:#fff;background:#57524A;box-shadow:none;vertical-align:1px}
footer{color:var(--ink-3);font-size:12.5px;margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
@media (max-width:760px){.langs{grid-template-columns:1fr}.flow{grid-template-columns:1fr 1fr}.toc{columns:1}h1{font-size:25px}}
@media print{@page{size:A4;margin:12mm}body{background:#fff;font-size:10pt}.wrap{padding:0;max-width:none}.bar{display:none}
 section.step{border:0;border-top:1px solid var(--line);padding:10px 0 4px;margin:8px 0}.shot{max-height:98mm;box-shadow:none}
 .lang li{font-size:9.3pt;margin-bottom:3px}.flow li{font-size:9pt}.step h2{font-size:13pt}.tip{font-size:9pt}.toc{font-size:10pt}
 a{color:inherit;text-decoration:none}
 .langs{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.flow{grid-template-columns:repeat(5,minmax(0,1fr))}.toc{columns:2}h1{font-size:20pt}}
"""
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Shippori+Mincho:wght@500;600&family=Noto+Sans+JP:wght@400;500&family=Jost:wght@400;500&family=IBM+Plex+Mono:wght@400&display=swap">'

def head(title, lang):
    return f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title>{FONTS}<style>{CSS}</style></head><body><div class="wrap">'

def langs(items):
    cols = []
    for k, lab, fl in (("id", "BAHASA INDONESIA", "id"), ("en", "ENGLISH", "en"), ("ja", "日本語", "jp")):
        cols.append(f'<div class="lang {k}" lang="{"id" if k=="id" else k}"><h3><i class="flag {fl}">{"EN" if fl=="en" else ""}</i>{lab}</h3><ol>' + "".join(f"<li>{e(x[k])}</li>" for x in items) + "</ol></div>")
    return '<div class="langs">' + "".join(cols) + "</div>"

h = [head("Panduan Formula Bridge / User guide / 使い方", "id")]
h.append(f'''<header><div class="brand">BIOT</div>
<h1>Formula Bridge — Panduan untuk pemasok<small>User guide for suppliers ／ 仕入先向け 使い方ガイド</small></h1>
<p class="meta">Artisans Production Co., Ltd. · {e(URL)}</p>
<div class="bar"><a href="{e(URL)}">Open Formula Bridge / Buka aplikasi</a><a class="ghost" href="formula-bridge-guide.pdf" download>PDF</a></div>
</header>
<p><i class="flag id"></i>Aplikasi ini menghubungkan tim pengembangan Artisans Production (Jepang) dengan perusahaan Anda: dari permintaan, formula, sampel, hingga umpan balik.<br>
<i class="flag en">EN</i>This app connects Artisans Production's development team (Japan) with your company: from the request, formula and sample to feedback.<br>
<i class="flag jp"></i>このアプリは、Artisans Production（日本）の開発チームと仕入先をつなぎ、依頼・処方・サンプル・フィードバックまでを一つの画面で進めます。</p>
<ol class="flow">''' + "".join(f'<li class="{c}"><b>{i+1}</b><span>{e(t["id"])}</span><span>{e(t["en"])}</span><span>{e(t["ja"])}</span></li>' for i, (t, c) in enumerate(FLOW)) + "</ol>")
h.append('<ol class="toc">' + "".join(f'<li><a href="#{a}">{e(t["id"])} / {e(t["en"])} / {e(t["ja"])}</a></li>' for a, t, *_ in S) + "</ol>")
for i, st in enumerate(S):
    a, t, img, items = st[:4]; tip = st[4] if len(st) > 4 else None
    h.append(f'<section class="step" id="{a}"><h2><span class="n">{i+1:02d}</span><span class="t"><span>{e(t["id"])}</span><span>{e(t["en"])} ／ {e(t["ja"])}</span></span></h2>')
    if img: h.append(f'<img class="shot" src="img/{img}.jpg" alt="{e(t["en"])}" loading="lazy">')
    h.append(langs(items))
    if tip: h.append(f'<p class="tip"><span>💡 {e(tip["id"])}</span><span>{e(tip["en"])}</span><span>{e(tip["ja"])}</span></p>')
    h.append("</section>")
h.append(f'<section class="step" id="tips"><h2><span class="n">★</span><span class="t"><span>Tips penting</span><span>Important tips ／ 大切なこと</span></span></h2>{langs(TIPS)}</section>')
h.append('<footer>Screenshots use sample (demo) data. / Tangkapan layar menggunakan data contoh. / スクリーンショットはデモ用のサンプルデータです。<br>© Artisans Production Co., Ltd. — Confidential / Rahasia / 社外秘（取引先限り）</footer></div></body></html>')
open(OUT + "supplier.html", "w", encoding="utf-8").write("\n".join(h))

# ---------------------------------------------------------------- Japan-side guide (Japanese)
J = [
("jp-overview", "全体の流れ（日本側）", "20-jp-master", [
 "マスター画面で、依頼している全社の状況（依頼・開発中・提出済み・フィードバック未実施）を一覧できます。",
 "流れ：①仕入先を登録 → ②STEP 1 で依頼を作って送る → ③STEP 2 で各社の提出を確認しフィードバック → ④STEP 3 で完成処方 → ⑤STEP 4 で企画書。",
 "画面上部の「FB（フィードバック）未実施」の帯には、提出またはサンプル発送があったのに、フィードバックをまだ送っていない会社が表示されます。必ず送ってください。",
]),
("jp-companies", "① 仕入先を登録する（初回のみ）", "21-jp-companies", [
 "メニュー「登録企業」→「仕入先の企業を登録する」に、会社名・代表者名・メールアドレス（ログインIDになります）を入れて「登録して招待メールを送る」を押します。仮パスワードのやりとりは不要です。",
 "相手には英語・インドネシア語の招待メールが自動で届き、ボタンから入って合意・パスワード設定・会社情報の入力を行います。",
 "メール送信がまだ設定されていない間は、画面にログイン用リンクが表示されます。WhatsApp などで本人だけに送ってください（1回だけ・期限付きで有効）。",
 "相手がパスワードを忘れたときは、相手自身がログイン画面の「Forgot password?」で新しいリンクを受け取れます。日本側からは一覧の「招待メールを再送」でも送れます。",
 "担当者の追加・削除は、各社の詳細画面（マスター画面で会社をクリック）の「ログインできる担当者」から行えます。仕入先の代表者も自分で追加・削除できます。同じ会社の担当者は全員、その会社あての依頼をすべて見られます（他社の情報は見えません）。",
 "希望原料費・完成品コスト・販売価格・試作希望日は「日本側のみ」の項目で、仕入先には表示されません（依頼書にも入りません）。",
]),
("jp-step1", "② STEP 1：依頼を作って送る", "22-jp-step1", [
 "「＋ 新規案件」で案件を作り、開発依頼の内容（コンセプト・目標原価・スケジュールなど）を日本語で入力します。",
 "「依頼書を作成（英語・インドネシア語）」で依頼書を作り、「日本語（確認用）」で意味を確認します。",
 "「依頼先を選んで送る」で会社を選び、「依頼先を確認する」→ 送信。相手には入力用リンクがメールで届きます。",
]),
("jp-step2", "③ STEP 2：各社の提出を確認する", "23-jp-step2", [
 "会社のタブを切り替えて、各社が入力した A〜F（製品概要・処方・原料の特長・試験・添付・発送）を見ます。",
 "処方は「日本語表示名称に変換」で日本語名を付け、Excel・PDF でも保存できます。",
 "サンプルが届いたら、下のフィードバック欄に進みます。",
]),
("jp-feedback", "③ STEP 2：フィードバックを送る（必須）", "26-jp-feedback", [
 "判定（採用候補・再試作を依頼・不採用・採用（本処方は当社に帰属））を選び、コメントを日本語で書きます。",
 "「翻訳して確認する」を押すと、英語とインドネシア語に訳され、別のAIが訳をチェックします。訳し戻しの日本語も確認できます。",
 "内容を確認して送ると、相手にメールが届き、相手の画面にも表示されます。",
]),
("jp-step3", "④ STEP 3：完成処方を作る", "24-jp-step3", [
 "採用する会社を1社選ぶと、その処方がベースとして取り込まれます。当社で加える原料を追記し、「水で100%に調整」で合計を100%にします。",
 "「全原料の表示名称を確認」で日本語表示名称を確認します。「要確認」は出典リンクを開いて目で確認し、「確認済みにする」を押します。",
 "全成分表示は配合量の多い順に自動で作られます。すべてそろったら「完成処方を確定」を押します。",
]),
("jp-step4", "⑤ STEP 4：企画書を作る", "25-jp-step4", [
 "「企画書を作成」で、市場調査 → 下書き → 査読 → 仕上げ の4工程をAIが行います（3〜6分、AIの利用料がかかります）。",
 "できた企画書（10ページ）は PowerPoint と Word でダウンロードできます。【要確認】の箇所は人の目で確認してください。",
]),
]
jh = [head("処方ブリッジ 使い方（日本側）", "ja")]
jh.append(f'''<header><div class="brand">BIOT</div><h1>処方ブリッジ — 使い方（日本側・社内用）<small>Artisans Production 社内向け</small></h1>
<p class="meta">{e(URL)} ・ 社外秘：このページは仕入先に送らないでください（他社名が写っています）。</p>
<div class="bar"><a href="{e(URL)}">処方ブリッジを開く</a><a class="ghost" href="supplier.html">仕入先向けガイド（3か国語）</a><a class="ghost" href="formula-bridge-guide-japan.pdf" download>PDF</a></div></header>
<p>仕入先の画面での操作は「仕入先向けガイド」に、インドネシア語・英語・日本語で並べて載せています。相手と電話やWhatsAppで話すときは、同じ番号の手順を見ながら案内できます。</p>''')
for i, (a, t, img, items) in enumerate(J):
    jh.append(f'<section class="step" id="{a}"><h2><span class="n">{i+1:02d}</span><span class="t"><span>{e(t)}</span></span></h2><img class="shot" src="img/{img}.jpg" alt="{e(t)}" loading="lazy"><div class="lang ja"><ol>' + "".join(f"<li>{e(x)}</li>" for x in items) + "</ol></div></section>")
jh.append('<footer>スクリーンショットはデモ用のサンプルデータです。 © Artisans Production Co., Ltd. 社外秘</footer></div></body></html>')
open(OUT + "japan.html", "w", encoding="utf-8").write("\n".join(jh))
print("built")
