-- Review fixes (2026-09-26).

-- 1. New users: admin rights only through confirmation of an allow-listed address (promote_confirmed_admin),
--    never at sign-up. A supplier company is created only for accounts made by Japan (create-supplier sets
--    app_metadata.fb_supplier, which users cannot set themselves). Any other sign-up gets no access.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); c jsonb := coalesce(m->'company', '{}'::jsonb); cid uuid;
begin
  if exists (select 1 from admin_emails where lower(email) = lower(new.email))
     or coalesce(new.raw_app_meta_data->>'fb_supplier', '') <> 'true' then
    insert into profiles (id, role, email, full_name, title, phone)
    values (new.id, 'supplier', new.email, m->>'full_name', m->>'title', m->>'phone');
  else
    insert into companies (name, address, website, nib, halal, materials, contact_name, contact_email, phone, whatsapp)
    values (coalesce(nullif(c->>'name',''), '(no name)'), c->>'address', c->>'website', c->>'nib', c->>'halal', c->>'materials',
            m->>'full_name', new.email, m->>'phone', m->>'whatsapp')
    returning id into cid;
    insert into profiles (id, role, company_id, email, full_name, title, phone, whatsapp)
    values (new.id, 'supplier', cid, new.email, m->>'full_name', m->>'title', m->>'phone', m->>'whatsapp');
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 2. Suppliers may edit their own company profile, but not its name, contact email (where Japan's confidential
--    requests are sent) or id; the logo must be in their own folder; completion / NDA times are set by the server.
create or replace function public.companies_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  new.id := old.id; new.name := old.name; new.contact_email := old.contact_email; new.created_at := old.created_at;
  if new.logo_path is distinct from old.logo_path and new.logo_path is not null
     and (new.logo_path not like old.id::text || '/logo/%' or new.logo_path like '%..%') then
    raise exception 'invalid logo path';
  end if;
  new.profile_completed_at := case when old.profile_completed_at is not null then old.profile_completed_at
                                   when new.profile_completed_at is not null then now() end;
  new.nda_agreed_at := case when old.nda_agreed_at is not null then old.nda_agreed_at
                            when new.nda_agreed_at is not null then now() end;
  return new;
end $$;
revoke execute on function public.companies_guard() from public, anon, authenticated;
drop trigger if exists companies_guard on public.companies;
create trigger companies_guard before update on public.companies for each row execute function public.companies_guard();

-- 3. Agreement log: acceptance time is the server's, and only the current version can be accepted.
create or replace function public.agreement_log_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.accepted_at := now();
  if not exists (select 1 from terms where doc = new.doc and version = new.version and current) then
    raise exception 'not the current version';
  end if;
  return new;
end $$;
revoke execute on function public.agreement_log_guard() from public, anon, authenticated;
drop trigger if exists agreement_log_guard on public.agreement_log;
create trigger agreement_log_guard before insert on public.agreement_log for each row execute function public.agreement_log_guard();

-- 4. Assignments: keep the first submission time while submitted; once Japan has finalized a formula based on
--    this submission, the supplier can no longer change it (evidence for the adopted formula).
create or replace function public.assignments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.project_id <> old.project_id or new.company_id <> old.company_id
     or new.request_snapshot <> old.request_snapshot or new.requested_at is distinct from old.requested_at
     or new.feedback <> old.feedback or new.feedback_at is distinct from old.feedback_at then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from finals where adopted_assignment = old.id and finalized_at is not null) then
    raise exception 'adopted formula is locked';
  end if;
  if new.status not in ('developing','submitted') or old.status = 'draft' then raise exception 'not allowed'; end if;
  if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now();
  elsif new.status = 'submitted' then new.submitted_at := old.submitted_at; end if;
  if new.shipped_at is distinct from old.shipped_at then
    if new.status <> 'submitted' then raise exception 'submit before shipping'; end if;
    new.shipped_at := case when new.shipped_at is null then null else now() end;
  end if;
  return new;
end $$;
revoke execute on function public.assignments_guard() from public, anon, authenticated;

-- 5. Administrator addresses are stored in lower case (create-supplier / invite compare lower-cased).
update public.admin_emails set email = lower(email) where email <> lower(email);
create or replace function public.admin_emails_lower() returns trigger
language plpgsql set search_path = public as $$ begin new.email := lower(trim(new.email)); return new; end $$;
revoke execute on function public.admin_emails_lower() from public, anon, authenticated;
drop trigger if exists admin_emails_lower on public.admin_emails;
create trigger admin_emails_lower before insert or update on public.admin_emails for each row execute function public.admin_emails_lower();

-- 6. Agreements, version 2026-09-26: the three languages now say exactly the same thing
--    (Japanese: "before disclosure", "as far as the law allows", delivery terms, "commercializes (sells)";
--    all: prices/delivery terms are conditions of supply, not properties of the raw materials).
--    The Japanese text is a reference translation; English and Indonesian are the signed versions.
update public.terms set current = false where current;
insert into public.terms (doc, version, title_en, title_id, title_ja, text_en, text_id, text_ja, current) values
('nda', '2026-09-26', 'Confidentiality Agreement (NDA)', 'Perjanjian Kerahasiaan (NDA)', '秘密保持契約（NDA）',
$en$Parties: Artisans Production Co., Ltd., Japan ("Artisans Production") and your company.

1. All information that your company receives from Artisans Production through Formula Bridge — including development requests, target costs, benchmark products, formulas, feedback, market information and business plans — is confidential information of Artisans Production.
2. Your company will not disclose confidential information to any third party, will use it only to develop products for Artisans Production, and will allow access only to employees who need it for that purpose and who are bound by the same obligations.
3. These obligations do not apply to information that was already public, that your company already lawfully held before receiving it from Artisans Production, or that must be disclosed by law (in which case your company will inform Artisans Production in advance where permitted by law).
4. These obligations continue for five (5) years after your company last uses Formula Bridge. On Artisans Production's request, your company will return or delete the confidential information.
5. This agreement is made in English and Bahasa Indonesia. Both versions are equally valid.$en$,
$id$Para pihak: Artisans Production Co., Ltd., Jepang ("Artisans Production") dan perusahaan Anda.

1. Semua informasi yang diterima perusahaan Anda dari Artisans Production melalui Formula Bridge — termasuk permintaan pengembangan, target biaya, produk acuan, formula, umpan balik, informasi pasar, dan rencana bisnis — merupakan informasi rahasia milik Artisans Production.
2. Perusahaan Anda tidak akan mengungkapkan informasi rahasia kepada pihak ketiga mana pun, hanya akan menggunakannya untuk mengembangkan produk bagi Artisans Production, dan hanya akan memberikan akses kepada karyawan yang memerlukannya untuk tujuan tersebut dan yang terikat oleh kewajiban yang sama.
3. Kewajiban ini tidak berlaku untuk informasi yang sudah bersifat publik, yang telah dimiliki secara sah oleh perusahaan Anda sebelum diterima dari Artisans Production, atau yang wajib diungkapkan berdasarkan hukum (dalam hal ini perusahaan Anda akan memberi tahu Artisans Production terlebih dahulu sejauh diizinkan oleh hukum).
4. Kewajiban ini berlaku hingga lima (5) tahun setelah perusahaan Anda terakhir kali menggunakan Formula Bridge. Atas permintaan Artisans Production, perusahaan Anda akan mengembalikan atau menghapus informasi rahasia tersebut.
5. Perjanjian ini dibuat dalam bahasa Inggris dan bahasa Indonesia. Kedua versi sama-sama berlaku.$id$,
$ja$当事者：株式会社Artisans Production（日本法人。以下「当社」）および貴社。

1. 貴社が処方ブリッジ（Formula Bridge）を通じて当社から受け取る情報（開発依頼、目標コスト、ベンチマーク品、処方、フィードバック、市場情報、事業計画を含む）は、すべて当社の秘密情報です。
2. 貴社は秘密情報を第三者に開示せず、当社向けの製品開発の目的にのみ使用し、その目的のために必要があり、かつ同一の義務を負う従業員にのみアクセスを認めます。
3. これらの義務は、既に公知の情報、当社から開示を受ける前から貴社が適法に保有していた情報、および法令により開示が必要な情報には適用しません（法令により開示する場合、貴社は法令上許される範囲で事前に当社へ通知します）。
4. これらの義務は、貴社が最後に処方ブリッジを利用した日から5年間続きます。当社の求めがあれば、貴社は秘密情報を返却または削除します。
5. 本契約は英語とインドネシア語で作成し、両言語版は同等に有効です。本日本語文は参考訳です。$ja$, true),

('purchase', '2026-09-26', 'Declaration of Purchase by Artisans Production', 'Pernyataan Pembelian oleh Artisans Production', '原料購入に関する当社宣言書',
$en$Parties: Artisans Production Co., Ltd., Japan ("Artisans Production") and your company.

1. If Artisans Production adopts a formula developed by your company through Formula Bridge and commercializes (sells) the product, Artisans Production declares that it will purchase from your company the raw materials in that formula that your company supplies.
2. This applies on condition that the raw materials meet the agreed specifications and quality standards (including a COA for each lot) and the laws and standards applicable in Japan, and are supplied at the agreed prices and on the agreed delivery terms.
3. Quantities, prices, delivery terms and other conditions will be set in a separate supply agreement between Artisans Production and your company.
4. By ticking the box, your company confirms that it has read and understood this declaration.
5. This declaration is made in English and Bahasa Indonesia. Both versions are equally valid.$en$,
$id$Para pihak: Artisans Production Co., Ltd., Jepang ("Artisans Production") dan perusahaan Anda.

1. Apabila Artisans Production mengadopsi formula yang dikembangkan oleh perusahaan Anda melalui Formula Bridge dan mengomersialkan (menjual) produknya, Artisans Production menyatakan akan membeli dari perusahaan Anda bahan baku dalam formula tersebut yang dipasok oleh perusahaan Anda.
2. Hal ini berlaku dengan syarat bahan baku memenuhi spesifikasi dan standar mutu yang disepakati (termasuk COA untuk setiap lot) serta peraturan dan standar yang berlaku di Jepang, dan dipasok dengan harga serta ketentuan pengiriman yang disepakati.
3. Jumlah, harga, ketentuan pengiriman, dan ketentuan lainnya akan ditetapkan dalam perjanjian pasokan terpisah antara Artisans Production dan perusahaan Anda.
4. Dengan mencentang kotak, perusahaan Anda menyatakan telah membaca dan memahami pernyataan ini.
5. Pernyataan ini dibuat dalam bahasa Inggris dan bahasa Indonesia. Kedua versi sama-sama berlaku.$id$,
$ja$当事者：株式会社Artisans Production（日本法人。以下「当社」）および貴社。

1. 当社が処方ブリッジ（Formula Bridge）を通じて貴社が開発した処方を採用し、その製品を商品化（販売）した場合、当社はその処方に含まれる貴社供給の原料を貴社から購入することを宣言します。
2. ただし、原料が合意した規格・品質基準（ロットごとのCOAを含む）および日本で適用される法令・基準を満たし、かつ合意した価格・納入条件で供給されることを条件とします。
3. 数量・価格・納入条件その他の条件は、当社と貴社の間の別途の供給契約で定めます。
4. チェックを入れることで、貴社は本宣言を読み、理解したことを確認します。
5. 本宣言は英語とインドネシア語で作成し、両言語版は同等に有効です。本日本語文は参考訳です。$ja$, true),

('ip', '2026-09-26', 'Ownership of Adopted Formulas', 'Kepemilikan Formula yang Diadopsi', '採用処方の帰属に関する合意',
$en$Parties: Artisans Production Co., Ltd., Japan ("Artisans Production") and your company.

1. If Artisans Production adopts a formula that your company developed through Formula Bridge, all rights to that formula — including its composition, percentages, manufacturing method and related data — belong to Artisans Production from the date of adoption.
2. Your company will not provide the same or a substantially similar formula to any third party, and will cooperate in preparing any documents Artisans Production reasonably needs to confirm this ownership.
3. Your company keeps all rights to its own raw materials, trade names and know-how that existed before the development. Formulas that Artisans Production does not adopt remain with your company.
4. Artisans Production will notify your company in writing (including by email or on Formula Bridge) when it adopts a formula.
5. This agreement is made in English and Bahasa Indonesia. Both versions are equally valid.$en$,
$id$Para pihak: Artisans Production Co., Ltd., Jepang ("Artisans Production") dan perusahaan Anda.

1. Apabila Artisans Production mengadopsi formula yang dikembangkan oleh perusahaan Anda melalui Formula Bridge, seluruh hak atas formula tersebut — termasuk komposisi, persentase, metode pembuatan, dan data terkait — menjadi milik Artisans Production sejak tanggal adopsi.
2. Perusahaan Anda tidak akan memberikan formula yang sama atau secara substansial serupa kepada pihak ketiga mana pun, dan akan bekerja sama dalam penyiapan dokumen yang secara wajar diperlukan Artisans Production untuk menegaskan kepemilikan ini.
3. Perusahaan Anda tetap memiliki seluruh hak atas bahan baku, nama dagang, dan pengetahuan (know-how) miliknya yang telah ada sebelum pengembangan. Formula yang tidak diadopsi oleh Artisans Production tetap menjadi milik perusahaan Anda.
4. Artisans Production akan memberi tahu perusahaan Anda secara tertulis (termasuk melalui email atau Formula Bridge) ketika mengadopsi suatu formula.
5. Perjanjian ini dibuat dalam bahasa Inggris dan bahasa Indonesia. Kedua versi sama-sama berlaku.$id$,
$ja$当事者：株式会社Artisans Production（日本法人。以下「当社」）および貴社。

1. 当社が処方ブリッジ（Formula Bridge）を通じて貴社が開発した処方を採用した場合、その処方（組成、配合比率、製造方法、関連データを含む）に関する一切の権利は、採用日から当社に帰属します。
2. 貴社は、同一または実質的に類似する処方を第三者に提供せず、当社がこの帰属を確認するために合理的に必要とする書類の作成に協力します。
3. 貴社は、開発前から保有する自社の原料、商品名、ノウハウに関する権利を引き続き保有します。当社が採用しなかった処方は貴社に帰属します。
4. 当社は、処方を採用した際に書面（メールまたは処方ブリッジ上を含む）で貴社に通知します。
5. 本合意は英語とインドネシア語で作成し、両言語版は同等に有効です。本日本語文は参考訳です。$ja$, true);
