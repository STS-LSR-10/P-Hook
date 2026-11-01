# แผนย้ายโฮสติ้งจาก Vercel ไป Cloudflare (เตรียมไว้ ยังไม่ย้าย)

**สถานะ (ต.ค. 2569):** ยังอยู่ Vercel · ระบบยังพัฒนาอยู่ จึงยังไม่ย้าย · โค้ดถูกเตรียมให้ย้ายได้โดยไม่ต้องแก้แอป

## 0) ตัดสินใจเมื่อไหร่

- **ก่อนเปิดรับเงินจริง (สลับ Stripe เป็น live) อย่างน้อย 2–3 สัปดาห์** ต้องเลือกอย่างใดอย่างหนึ่ง เพราะ Vercel Hobby ใช้ได้เฉพาะงานที่ไม่ใช่เชิงพาณิชย์
  - **ทาง A — Vercel Pro** ($20/เดือน): ไม่ต้องย้าย ไม่ต้องแก้โค้ด เสี่ยงต่ำสุด
  - **ทาง B — Cloudflare Workers Paid** ($5/เดือน): ถูกกว่า ต้องย้ายตามแผนข้างล่าง
- ถ้าถึงวันตัดสินใจแล้วยังไม่แน่ใจ ใช้ทาง A เดือนแรกไปก่อน แล้วย้ายทีหลังได้ (โค้ดพร้อมย้ายอยู่แล้ว)
- ไม่แนะนำ Netlify: ไม่ถูกกว่า Cloudflare, ใช้เครดิตรายเดือนและเว็บอาจถูกพักเมื่อเครดิตหมด, เงื่อนไขใช้เชิงพาณิชย์ในแผนฟรียังไม่ยืนยัน

## 1) สิ่งที่เตรียมไว้แล้ว

| เรื่อง                       | สถานะ                                                                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ตัวตั้งเวลา (cron)           | ✅ อยู่ที่ GitHub Actions ทั้งหมด (`.github/workflows/cron.yml`, ทุกชั่วโมง: จดรายการประจำ + เตือน/สรุป) ไม่มี Vercel Cron แล้ว ย้ายโฮสต์ได้โดยแก้แค่ secret `APP_BASE_URL`                                                                                       |
| ไม่ผูกกับ Vercel             | ✅ ไม่มี `@vercel/*`, ไม่อ่าน `VERCEL_*`, ไม่มี route แบบ edge-only (มีเทสต์ `src/portability.test.ts` กันไม่ให้หลุดเข้ามา)                                                                                                                                       |
| โมดูล Node ที่ใช้            | ✅ ใช้เฉพาะ `node:crypto` (ลายเซ็น LINE/Stripe, rate limit) เทสต์เดียวกันกัน import `fs`/`path`/`zlib`/ฯลฯ ที่ Workers ไม่รองรับ                                                                                                                                  |
| ทดลองบน workerd จริง (local) | ✅ ผ่านบน Cloudflare Workers runtime ในเครื่อง (`wrangler dev --local`, `nodejs_compat`): `createHash`, `createHmac`, `timingSafeEqual`, `randomBytes`, **`scrypt` (N=16384, r=8, p=1)**, สร้างไฟล์ Excel ด้วย `exceljs`, `jose` (HS256), `@supabase/supabase-js` |
| endpoint ตั้งเวลา            | ✅ เรียกซ้ำได้ปลอดภัย (จดประจำถูกจองครั้งเดียวต่อวันครบกำหนด และตามให้ครบถ้าพลาดรอบ)                                                                                                                                                                              |

## 2) สิ่งที่ยังไม่รู้ (ต้องวัดตอนย้ายจริง)

- **เวลา CPU ต่อคำขอ:** แผนฟรีจำกัด 10 ms (แผน Paid ให้ 30 วินาที) เดิมตัวที่เสี่ยงคือ scrypt ของ PIN ซึ่งลบออกแล้ว เหลือส่งออก Excel และการอ่านไฟล์ PDF/ภาพ ที่ต้องวัดตอนทดลองจริง
- **ขนาดโค้ดหลังบิลด์ด้วย OpenNext:** Next 15 + `exceljs` มักเกินลิมิตแผนฟรี (3 MB บีบอัด) แผน Paid ให้ราว 15 MB (เช็กหน้า Limits ล่าสุดก่อน)
- **ความเข้ากันของ OpenNext กับเวอร์ชัน Next ที่ใช้อยู่** ตอนบิลด์จริง (ทดสอบตอนย้าย ไม่ใช่ตอนนี้)

## 3) ขั้นตอนย้าย (ทำตอนตัดสินใจเลือกทาง B)

**ผมทำให้ (โค้ด):**

1. เพิ่ม `@opennextjs/cloudflare` + `wrangler`, `wrangler.jsonc` (`nodejs_compat`, compatibility date ล่าสุด), `open-next.config.ts`, สคริปต์ `cf:preview` / `cf:deploy`, `.dev.vars.example`
2. รัน `opennextjs-cloudflare preview` ในเครื่อง ทดสอบ: บิลด์ผ่าน ขนาดไม่เกินลิมิต, LINE/Stripe webhook ลายเซ็นผ่าน, ส่งออก Excel
3. ปรับ CI ให้ตรวจว่าบิลด์สำหรับ Cloudflare ผ่านทุกครั้ง · อัปเดต `docs/DEPLOY.md`
4. (ถ้าต้องการ) ย้ายตัวตั้งเวลาไป Cloudflare Cron Triggers แทน GitHub Actions

**คุณทำเอง (ผมทำแทนไม่ได้):**

1. สมัคร Cloudflare + **Workers Paid** · (ถ้ามีโดเมน ผูกโดเมนกับ Cloudflare)
2. ผูก GitHub repo ใน Workers Builds (หรือสร้าง API token ถ้าใช้ GitHub Actions deploy)
3. ใส่ secrets ทั้งหมดเอง (ชื่อด้านล่าง) ด้วย `wrangler secret put` หรือแดชบอร์ด — **อย่าส่งค่าในแชท**
4. ตอนสลับ: เปลี่ยน URL ที่ LINE (Webhook + LIFF Endpoint), Stripe (Webhook), env `APP_BASE_URL` และ GitHub secret `APP_BASE_URL`

**ชื่อ secrets/ตัวแปรที่ต้องย้ายไปด้วย:** `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_LOGIN_CHANNEL_ID`, `NEXT_PUBLIC_LIFF_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_JWT_SECRET`, `CRON_SECRET`, `APP_BASE_URL`, `AI_PROVIDER` (+ `AI_MODEL`) และ key ของค่าย AI, `EASYSLIP_API_KEY`, `SLIP_READERS`, `NEXT_PUBLIC_CONTACT_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` · ตัวแปร `NEXT_PUBLIC_*` ต้องมีตอน **บิลด์** ด้วย (ไม่ใช่แค่ตอนรัน)

**ลำดับสลับ (ไม่หยุดบริการ):**

1. deploy ขึ้น Cloudflare ที่ URL ชั่วคราว (`*.workers.dev`) ใส่ secrets ตรวจตาม `docs/LINE-TEST-CHECKLIST.md`
2. เปลี่ยน URL ที่ LINE → Stripe → GitHub secret `APP_BASE_URL` → ทดสอบบนมือถือ
3. เก็บ Vercel ไว้อย่างน้อย 1 สัปดาห์เป็นทางย้อนกลับ (ย้อน = เปลี่ยน URL กลับ) แล้วค่อยปิด

**หมายเหตุ:** ระบบ PIN ถูกลบออกแล้ว (migration 0045) จึงไม่มี scrypt ที่กิน CPU อีก ส่วน `SESSION_JWT_SECRET` ยังต้องใช้ค่าเดิมเพื่อให้ session และลิงก์ส่งออกที่ออกไปแล้วยังใช้ได้

## 4) ผลทดลองบิลด์จริง (31 ต.ค. 2569, branch `cloudflare-trial`)

- `pnpm cf:build` ผ่าน (OpenNext 1.20.15 + Next 15.5.28) · ขนาดที่ wrangler รายงาน: **13.2 MB ไม่บีบอัด / 2.6 MB บีบอัด** (ลิมิตแผนฟรี 3 MB บีบอัด)
- ทดสอบ `cf:preview` บน workerd ในเครื่อง: หน้าเว็บ/ไฟล์ static ตอบ 200 · LINE webhook ลายเซ็นผิด 401 / ถูก 200 · cron ไม่มี secret 401 · PDF และ Excel สร้างได้
- ต้องมี `cf-polyfill.mjs` (ตอบ `process.umask()`) เพราะไลบรารีส่งออกเรียกตอนโหลดแล้ว Workers ตอบ not implemented · `wrangler.jsonc` ชี้ `main` ไปที่ `cf-worker.mjs` ซึ่งโหลด polyfill ก่อน
- รัน `pnpm cf:build` ต้องมี `pnpm` อยู่ใน PATH (OpenNext เรียก `pnpm build` เอง)

## 5) ผลวัด CPU และขั้นตอนสลับจริง (ตัดสินใจ: ใช้ Workers Paid)

**ผลวัดบน workers.dev (1 พ.ย. 2569):** คำขอธรรมดา 25–47 ms, ส่งออกไฟล์ 738 ms (รวมค่าเริ่มต้น), หมวดหมู่ 326 ms (ครั้งแรก) → เกิน 10 ms ของแผนฟรีทุกคำขอ จึงใช้ **Workers Paid**

**Worker:** ชื่อ `phook` (ตั้งใน `wrangler.jsonc`) · deploy ด้วย `pnpm cf:deploy` (ต้องมี `pnpm` ใน PATH และ `.env.local` ครบ `NEXT_PUBLIC_*` ตอนบิลด์) · secrets ตั้งบน Cloudflare (ชื่อตามหัวข้อ 3; ตั้ง `AI_PROVIDER` ได้ ว่างได้ = gemini)

**LIFF:** Rich Menu และลิงก์ในแชททั้งหมดใช้ LIFF ID เดิม → ตอนสลับ **ใช้ LIFF ID เดิมของจริง** (ไม่ใช่ตัวทดสอบ) แล้วเปลี่ยนแค่ Endpoint URL ของมัน

**ลำดับสลับ (ย้อนกลับได้ทุกขั้น ถ้ายังไม่ปิด Vercel):**

1. สมัคร/ยืนยัน Workers Paid ที่ Cloudflare → Billing
2. `.env.local` ใส่ `NEXT_PUBLIC_LIFF_ID` ของจริงกลับ → `pnpm cf:deploy`
3. ตั้ง secret `APP_BASE_URL` บน Cloudflare เป็น URL ใหม่ (workers.dev หรือโดเมนของคุณ)
4. LINE Developers: LIFF จริง → Endpoint URL = URL ใหม่ · Messaging API → Webhook URL = `<URL ใหม่>/api/line/webhook` → กด Verify
5. Stripe (ถ้าใช้): Webhook endpoint ชี้ `<URL ใหม่>/api/stripe/webhook` (ใช้ signing secret ตัวเดิมได้ถ้าแก้ endpoint เดิม)
6. GitHub → Secrets: `APP_BASE_URL` = URL ใหม่ และ `CRON_SECRET` = ค่าเดียวกับที่ตั้งบน Cloudflare
7. ทดสอบตาม `docs/LINE-TEST-CHECKLIST.md` (แชท, LIFF, ส่งออก, จ่ายเงิน, เตือน)
8. เก็บ Vercel ไว้ ≥ 1 สัปดาห์เป็นทางย้อนกลับ (ย้อน = เปลี่ยน Endpoint/Webhook/GitHub secret กลับ) แล้วค่อยปิด

**ดูปัญหา:** Cloudflare → Workers → `phook` → Logs/Observability หรือ `npx wrangler tail phook`

## 6) ตัวตั้งเวลา (cron) ย้ายมาอยู่ที่ Cloudflare แล้ว

- ปัญหาเดิม: GitHub Actions เริ่มรอบ `*/5` ช้าได้เป็นสิบๆ นาที (เตือน 09:04 มาถึง 09:25) → ใช้ **Cron Triggers ของ Cloudflare** แทน ตรงเวลาระดับนาที
- `wrangler.jsonc` → `triggers.crons`: `* * * * *` (เตือนของผู้ใช้ `/api/cron/user-reminders`) และ `7 * * * *` (จดประจำ `/api/cron/recurring` + เตือน/สรุปอัตโนมัติ `/api/cron/reminders`)
- `cf-worker.mjs` มี handler `scheduled` เรียก route เดิมภายใน Worker ด้วย `CRON_SECRET` + `APP_BASE_URL` (secret บน Cloudflare) ไม่ต้องมี GitHub secret อีกต่อไป
- workflow ใน `.github/workflows/cron*.yml` ตัด `schedule` ออกแล้ว เหลือ `workflow_dispatch` ไว้ยิงมือเพื่อทดสอบ
- ดู log: `npx wrangler tail phook` (บรรทัด `cf_cron`)
