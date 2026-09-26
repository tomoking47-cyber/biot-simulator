-- Wording polish of the current terms (version 2026-09-26; nobody had accepted it yet when this was applied).
-- EN/JA now match the Indonesian "memiliki kekuatan hukum yang sama" (equally authentic / 同等の効力).
update public.terms set
  text_en = replace(text_en, 'Both versions are equally valid.', 'Both versions are equally authentic.'),
  text_ja = replace(replace(replace(text_ja,
              '両言語版は同等に有効です。', '両言語版は同等の効力を有します。'),
              '5年間続きます。', '5年間存続します。'),
              '書面（メールまたは処方ブリッジ上を含む）', '書面（メールまたは処方ブリッジ上での通知を含む）'),
  text_id = replace(text_id, 'Kewajiban ini berlaku hingga lima (5) tahun setelah', 'Kewajiban ini tetap berlaku selama lima (5) tahun setelah')
where version = '2026-09-26'
  and not exists (select 1 from public.agreement_log l where l.version = '2026-09-26');
