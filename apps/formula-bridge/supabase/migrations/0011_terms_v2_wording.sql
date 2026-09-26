-- Agreements 2026-09-26 (not yet accepted by anyone): Japanese word order in clause 1 (the supplier developed the formula
-- through Formula Bridge), and the Indonesian language clause in standard legal wording.
update public.terms set
  text_ja = replace(replace(text_ja,
    '当社が処方ブリッジ（Formula Bridge）を通じて貴社が開発した処方を採用し、その製品を商品化（販売）した場合',
    '貴社が処方ブリッジ（Formula Bridge）を通じて開発した処方を当社が採用し、その製品を商品化（販売）した場合'),
    '当社が処方ブリッジ（Formula Bridge）を通じて貴社が開発した処方を採用した場合',
    '貴社が処方ブリッジ（Formula Bridge）を通じて開発した処方を当社が採用した場合'),
  text_id = replace(text_id, 'Kedua versi sama-sama berlaku.', 'Kedua versi memiliki kekuatan hukum yang sama.')
where version = '2026-09-26';
