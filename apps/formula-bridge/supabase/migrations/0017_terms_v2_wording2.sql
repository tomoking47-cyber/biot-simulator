-- Wording fixes found in the full review (version 2026-09-26; nobody had accepted it yet when this was applied).
-- The meaning is unchanged. Titles: "raw material" was missing in English and Indonesian.
update public.terms set
  title_en = replace(title_en, 'Declaration of Purchase by Artisans Production', 'Declaration of Raw Material Purchase by Artisans Production'),
  title_id = replace(title_id, 'Pernyataan Pembelian oleh Artisans Production', 'Pernyataan Pembelian Bahan Baku oleh Artisans Production'),
  text_en = replace(text_en, 'already lawfully held', 'lawfully held'),
  text_id = replace(replace(replace(text_id,
              'formula yang sama atau secara substansial serupa', 'formula yang sama atau serupa secara substansial'),
              'Dengan mencentang kotak', 'Dengan mencentang kotak persetujuan'),
              'melalui email', 'melalui surel (email)'),
  text_ja = replace(text_ja, '書面（メールまたは処方ブリッジ上での通知を含む）で貴社に通知します', '書面（電子メールまたは処方ブリッジ上での表示を含む。）により貴社に通知します')
where version = '2026-09-26'
  and not exists (select 1 from public.agreement_log l where l.version = '2026-09-26');
