import { emojiOf } from "@/lib/category-emoji";

/** What an entry needs to pick its icon. */
export interface TxIconInput {
  title: string;
  categoryIcon?: string | null;
}

/**
 * Words in an entry's title and the icon that goes with them. The first that matches wins, so the
 * specific ones come first. Thai has no spaces between words, so a short word that is part of many
 * others (ยา, หมา, หมอ, น้ำมัน) says what it must not be followed by.
 */
const WORDS: [RegExp, string][] = [
  // drinks
  [/กาแฟ|\bcoffee\b|\blatte\b|ลาเต้|คาปูชิโน|อเมริกาโน่|เอสเพรสโซ|คาเฟ่|\bcafe\b/i, "☕"],
  [/ชานม|ชาไทย|ชาเขียว|ชาไข่มุก|ไข่มุก|ชาเย็น|โกโก้|\bboba\b|\bbubble tea\b/i, "🧋"],
  [/เบียร์|\bbeer\b|เหล้า|วิสกี้|เหล้าขาว|สุรา/i, "🍺"],
  [/ไวน์|\bwine\b/i, "🍷"],
  [/น้ำอัดลม|โค้ก|เป๊ปซี่|เป็ปซี่|\bcoke\b|\bpepsi\b/i, "🥤"],
  [/น้ำเปล่า|น้ำดื่ม/, "💧"],
  // food
  [/ไอศกรีม|ไอติม|ไอสครีม/, "🍦"],
  [/ขนม|เค้ก|เบเกอรี่|โดนัท|คุกกี้|ของหวาน|บิงซู/, "🍰"],
  [/พิซซ่า|\bpizza\b/i, "🍕"],
  [/เบอร์เกอร์|\bburger\b|แมคโดนัลด์|\bmcdonald\b/i, "🍔"],
  [/ซูชิ|ซาซิมิ|ข้าวหน้าเนื้อ|\bsushi\b/i, "🍣"],
  [/ชาบู|สุกี้|หม้อไฟ|ปลาหมึก/, "🍲"],
  [/หมูกระทะ|หมูปิ้ง|หมูย่าง|ปิ้งย่าง|สเต็ก|บาร์บีคิว|\bbbq\b|ยากินิกุ|ปีกไก่/i, "🥩"],
  [/ไก่ทอด|\bkfc\b|ไก่ย่าง/i, "🍗"],
  [/ก๋วยเตี๋ยว|ก๊วยเตี๋ยว|บะหมี่|ราเมน|ราเมง|เส้นใหญ่|เย็นตาโฟ|ต้มยำ|ผัดไทย|ส้มตำ/, "🍜"],
  [/ข้าว/, "🍚"],
  // moving around
  [
    /\blineman\b|ไลน์แมน|\bfoodpanda\b|ฟู้ดแพนด้า|ส่งอาหาร|เดลิเวอรี่|เดลิเวอรี|\bdelivery\b/i,
    "🛵",
  ],
  [
    /แท็กซี่|\btaxi\b|\bgrab(?!food)|แกร็บ|\bbolt\b|\buber\b|อูเบอร์|วินมอเตอร์ไซค์|ค่าวิน|มอไซค์รับจ้าง/i,
    "🚕",
  ],
  [/รถไฟฟ้า|\bbts\b|\bmrt\b|รถไฟใต้ดิน|แอร์พอร์ตลิงก์|\bairport rail\b/i, "🚇"],
  [/รถเมล์|รถตู้|รถทัวร์|บขส|รถสองแถว|เรือโดยสาร|รถไฟ/, "🚌"],
  [/ตั๋วเครื่องบิน|เครื่องบิน|แอร์เอเชีย|ไทยสมายล์|สายการบิน|\bflight\b/i, "✈️"],
  [
    /น้ำมัน(?!พืช|หอย|งา|มะกอก|รำข้าว)|เติมน้ำมัน|ปตท|เชลล์|\bshell\b|เบนซิน|ดีเซล|แก๊สโซฮอล์/i,
    "⛽",
  ],
  [/ทางด่วน|\beasy pass\b|อีซี่พาส|\bm-pass\b|ค่าผ่านทาง/i, "🛣️"],
  [/ที่จอดรถ|ค่าจอด|จอดรถ|ล้างรถ|ซ่อมรถ|เปลี่ยนยาง|เปลี่ยนน้ำมันเครื่อง|ประกันรถ|พ.ร.บ./, "🚗"],
  // home and bills
  [/โรงแรม|ที่พัก|โฮสเทล|รีสอร์ท|รีสอร์ต|\bagoda\b|\bairbnb\b|\bbooking\b/i, "🏨"],
  [/ค่าเช่า|ค่าห้อง|ค่าคอนโด|ค่าส่วนกลาง|ค่าหอ|ผ่อนบ้าน|ผ่อนคอนโด/, "🏠"],
  [/ค่าไฟ|การไฟฟ้า|ไฟฟ้า/, "💡"],
  [/ค่าน้ำ|ประปา/, "🚰"],
  [/อินเทอร์เน็ต|อินเตอร์เน็ต|ค่าเน็ต|เน็ตบ้าน|\bwifi\b|ไวไฟ|\bfibre\b|\bfiber\b/i, "📶"],
  [/ค่าโทร|เติมเงิน|เติมมือถือ|ค่ามือถือ|ซิม|\bais\b|\bdtac\b|\btruemove\b|ทรู/i, "📱"],
  [/ซักผ้า|ซักรีด|ร้านซัก/, "🧺"],
  // fun
  [/เกม|\bgame\b|\bsteam\b|\bplaystation\b|\bnintendo\b|เติมเกม|\brov\b/i, "🎮"],
  [/หนัง|โรงหนัง|\bnetflix\b|เน็ตฟลิกซ์|\bdisney\b|ซีรีส์|ซีรีย์/i, "🎬"],
  [/\bspotify\b|สปอติฟาย|เพลง|คอนเสิร์ต|หูฟัง/i, "🎧"],
  [/ฟิตเนส|ยิม|\bgym\b|โยคะ|ออกกำลังกาย|พิลาทิส/i, "🏋️"],
  [/แบดมินตัน|ฟุตบอล|สนามกีฬา|กอล์ฟ|วิ่ง|ปั่นจักรยาน/, "⚽"],
  [/ทริป|ท่องเที่ยว|เที่ยว|ทะเล|ภูเขา/, "🏖️"],
  [/ปาร์ตี้|เลี้ยง|ฉลอง|วันเกิด/, "🎉"],
  [/ของขวัญ|\bgift\b|ช่อดอกไม้|ดอกไม้/i, "🎁"],
  // health and looks
  [/ทำฟัน|ทันตกรรม|จัดฟัน|ขูดหินปูน|หมอฟัน/, "🦷"],
  [/ร้านยา|ซื้อยา|ค่ายา|วิตามิน|ยา(?![งนมกวยลด])/, "💊"],
  [/หมอ(?!น)|โรงพยาบาล|รพ\.|คลินิก|ตรวจสุขภาพ|ตรวจเลือด|ค่ารักษา|ประกันสุขภาพ/, "🩺"],
  [/ตัดผม|ทำผม|ซอยผม|เสริมสวย|ย้อมผม|ดัดผม/, "💇"],
  [/ทำเล็บ|เล็บ/, "💅"],
  [/นวด|สปา|\bspa\b/i, "💆"],
  // buying things
  [/รองเท้า/, "👟"],
  [/เสื้อ|กางเกง|กระโปรง|ชุด(?!อาหาร)|แว่น/, "👕"],
  [
    /ไอโฟน|\biphone\b|โน้ตบุ๊ก|โน๊ตบุ๊ค|คอมพิวเตอร์|แท็บเล็ต|\bipad\b|ไอแพด|แอป|\bapp store\b/i,
    "💻",
  ],
  [/อาหารแมว|ทรายแมว|แมว/, "🐱"],
  [/อาหารหมา|อาหารสุนัข|สุนัข|หมา(?![กยลวสบ])/, "🐶"],
  [
    /ซุปเปอร์|ซูเปอร์|ตลาด|โลตัส|บิ๊กซี|เซเว่น|7-11|7eleven|แม็คโคร|ท็อปส์|เทสโก้|ซื้อของ|ของใช้|เซ็นทรัล/i,
    "🛒",
  ],
  // school, money
  [/ค่าเทอม|ค่าเรียน|คอร์ส|หลักสูตร|เรียนพิเศษ|กวดวิชา|ติวเตอร์/, "🎓"],
  [/หนังสือ|หนังสือเรียน|นิยาย|การ์ตูน/, "📚"],
  [/ทำบุญ|บริจาค|ใส่บาตร|ไหว้พระ|สังฆทาน/, "🙏"],
  [/เงินเดือน|โบนัส|\bsalary\b/i, "💰"],
  [/หุ้น|กองทุน|คริปโต|ลงทุน|ปันผล|ดอกเบี้ย/, "📈"],
  [/ฝากออม|เงินออม|ออมทอง|ออมเงิน|ออม/, "🐷"],
  [/บัตรเครดิต|ผ่อน|งวด|หนี้|ดอกบัตร/, "💳"],
  [/ภาษี|ประกันสังคม|ค่าปรับ/, "🧾"],
  [/ซ่อม|ช่าง/, "🔧"],
];

/** The icons of the system categories (their `icon` column holds a Lucide name) as emoji. */
const BY_ICON_NAME: Record<string, string> = {
  utensils: "🍜",
  bus: "🚌",
  home: "🏠",
  smartphone: "📱",
  "shopping-bag": "🛍️",
  "heart-pulse": "🩺",
  popcorn: "🍿",
  "graduation-cap": "🎓",
  zap: "⚡",
  "credit-card": "💳",
  "piggy-bank": "🐷",
  ellipsis: "📦",
  wallet: "💰",
  store: "🏪",
  briefcase: "💼",
  "badge-percent": "🏷️",
  package: "📦",
  "trending-up": "📈",
  tag: "🏷️",
};

/**
 * The icon for an entry, or null when there is none to show. In order: the emoji a person gave their
 * own category, a word of the title (กาแฟ → ☕), then the icon of a system category.
 */
export function txEmoji(tx: TxIconInput): string | null {
  const own = emojiOf(tx.categoryIcon);
  if (own) return own;
  const title = tx.title.trim().toLowerCase();
  for (const [re, emoji] of WORDS) if (re.test(title)) return emoji;
  const named = tx.categoryIcon ? BY_ICON_NAME[tx.categoryIcon] : undefined;
  return named ?? null;
}
