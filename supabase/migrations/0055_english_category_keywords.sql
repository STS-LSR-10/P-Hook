-- English keywords for the default categories, so "coffee 30" or "taxi 120" typed in English lands in
-- the right category as the Thai words do. Only adds the words a category does not have yet; the Thai
-- ones and anything a person added stay. Additive and idempotent.

with words(type, name, add) as (values
  ('expense', 'อาหาร', array['food','coffee','lunch','dinner','breakfast','meal','snack','tea','drink','drinks','restaurant','cafe','groceries','grocery','noodles','rice','pizza','burger','dessert','bakery']),
  ('expense', 'เดินทาง', array['fuel','gas','petrol','bus','train','metro','taxi','uber','bolt','toll','parking','flight','ticket','transport','fare']),
  ('expense', 'ที่พัก', array['rent','condo','apartment','room','hotel','dorm','housing']),
  ('expense', 'ค่าโทรศัพท์', array['phone','mobile','internet','wifi','data plan','phone bill']),
  ('expense', 'ช้อปปิ้ง', array['shopping','clothes','shirt','shoes','amazon','mall','gift']),
  ('expense', 'สุขภาพ', array['doctor','medicine','pharmacy','hospital','clinic','gym','dentist','health','vitamins']),
  ('expense', 'บันเทิง', array['movie','cinema','game','games','concert','party','bar','beer','trip','travel']),
  ('expense', 'การศึกษา', array['tuition','course','book','books','school','class','study']),
  ('expense', 'ค่าน้ำ-ไฟ', array['water','electricity','electric','power','utilities','water bill']),
  ('expense', 'ผ่อน/หนี้', array['installment','loan','debt','credit card','interest']),
  ('expense', 'ออม/ลงทุน', array['savings','saving','invest','investment','fund','stocks','crypto']),
  ('income', 'เงินเดือน', array['salary','wage','wages','paycheck','bonus']),
  ('income', 'ธุรกิจส่วนตัว', array['profit','business','revenue','shop income']),
  ('income', 'งานพิเศษ', array['freelance','side job','part time','gig']),
  ('income', 'ค่าคอมมิชชั่น', array['commission']),
  ('income', 'ขายของ', array['sold','sale','sales','selling']),
  ('income', 'ปันผล/ดอกเบี้ย', array['dividend','interest income','dividends'])
)
update categories c
   set keywords = c.keywords || array(
     select w from unnest(words.add) as w where not (w = any (c.keywords))
   )
  from words
 where c.user_id is null and c.type::text = words.type and c.name = words.name;
