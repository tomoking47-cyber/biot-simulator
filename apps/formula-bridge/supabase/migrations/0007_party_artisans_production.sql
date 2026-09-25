-- Contracting party: Artisans Production Co., Ltd. (株式会社Artisans Production). Applied before any acceptance.
update public.terms set
  title_en = replace(title_en, 'BIOT', 'Artisans Production'),
  title_id = replace(title_id, 'BIOT', 'Artisans Production'),
  text_en = 'Parties: Artisans Production Co., Ltd., Japan ("Artisans Production") and your company.' || E'\n\n' || replace(text_en, 'BIOT', 'Artisans Production'),
  text_id = 'Para pihak: Artisans Production Co., Ltd., Jepang ("Artisans Production") dan perusahaan Anda.' || E'\n\n' || replace(text_id, 'BIOT', 'Artisans Production'),
  text_ja = '当事者：株式会社Artisans Production（日本。以下「当社」）と貴社' || E'\n\n' || replace(text_ja, 'BIOT', '当社')
where version = '2026-09-25' and text_en not like 'Parties:%';
