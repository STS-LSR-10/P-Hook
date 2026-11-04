# ตั้งค่า Google Calendar (เพิ่มเตือนลงปฏิทิน Google)

ปุ่ม **📅 เพิ่มลงปฏิทิน** บนการ์ดเตือนส่วนตัวมี 2 ทาง:

- **ปฏิทินในเครื่อง** (.ics) ใช้ได้ทันที ไม่ต้องตั้งค่าอะไร
- **Google Calendar** ถ้ายังไม่ตั้งค่าตามขั้นตอนด้านล่าง จะเปิดหน้า "เพิ่มกิจกรรม" ของ Google ที่กรอกไว้ให้ ผู้ใช้กดบันทึกเอง ไม่ต้อง sign in แต่ไม่ซิงก์ พอตั้งค่าครบ จะใช้ sign in with Google และซิงก์การแก้หรือยกเลิกให้อัตโนมัติ

> ห้ามส่งค่า secret ใด ๆ ในแชท หรือ commit ลง git

## 1. รัน migration

ใน Supabase → SQL Editor ให้รัน `supabase/migrations/0056_google_calendar.sql` ไฟล์นี้เพิ่มอย่างเดียวและรันซ้ำได้ ต้องรันก่อนใส่ secret ของ Google
(ถ้ายังไม่รัน การแก้ เลื่อน และยกเลิกเตือนยังใช้ได้ตามปกติ แค่ยังซิงก์กับ Google ไม่ได้)

## 2. Google Cloud Console

1. ไปที่ <https://console.cloud.google.com/> แล้วสร้างหรือเลือกโปรเจกต์
2. **APIs & Services → Library** ค้นหา **Google Calendar API** แล้วกด **Enable**
3. **APIs & Services → OAuth consent screen** (หรือ **Google Auth Platform**):
   - User type: **External**
   - App name: `พี่ฮูก` และใส่อีเมลติดต่อ, โลโก้, ลิงก์นโยบายความเป็นส่วนตัว และ Terms (ต้องมีเพื่อขอ verify)
   - Authorized domains: โดเมนของแอป (โดเมนเดียวกับ `APP_BASE_URL`)
   - **Data access / Scopes** ให้เพิ่มแค่ 3 อย่าง: `openid`, `.../auth/userinfo.email`, `.../auth/calendar.events`
   - ช่วงทดสอบ: เพิ่มอีเมลผู้ทดสอบใน **Test users** (ได้สูงสุด 100 คน)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://<โดเมนของแอป>/api/google/callback`
     (ต้องตรงกับ `APP_BASE_URL` + `/api/google/callback` ทุกตัวอักษร)
   - กด Create แล้วจะได้ **Client ID** กับ **Client secret**

## 3. ใส่ secret ใน Cloudflare

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

กุญแจเข้ารหัส refresh token ต้องเป็นค่าสุ่ม 32 ไบต์แบบ base64 ให้สร้างในเครื่องแล้ววางตอน wrangler ถาม:

```bash
openssl rand -base64 32
```

```bash
npx wrangler secret put GOOGLE_TOKEN_KEY
```

> **อย่าเปลี่ยน `GOOGLE_TOKEN_KEY` หลังมีคนเชื่อมแล้ว** ถ้าเปลี่ยน token ที่เก็บไว้จะเปิดไม่ได้ ทุกคนต้องเชื่อมใหม่
> ถ้าจะรันในเครื่อง ให้ใส่ทั้ง 3 ค่าใน `.env.local` เอง

ใส่ครบแล้ว deploy ใหม่ ปุ่ม Google จะเปลี่ยนเป็นแบบ sign in ให้เอง และหน้าตั้งค่า (ใต้การแจ้งเตือน) จะมีการ์ด Google Calendar ไว้ดูบัญชีที่เชื่อมและยกเลิกการเชื่อม

## 4. ขอ verify กับ Google (ก่อนเปิดให้ทุกคน)

`calendar.events` เป็น scope ระดับ **sensitive** ถ้ายังไม่ได้ verify:

- ผู้ใช้จะเห็นหน้า "Google hasn't verified this app" และต้องกด Advanced → ไปต่อ
- ใช้ได้เฉพาะ Test users ไม่เกิน 100 คน
- ระหว่างที่แอปอยู่ในสถานะ **Testing**, refresh token จะหมดอายุใน 7 วัน การเชื่อมจะหลุดเองและผู้ใช้ต้อง sign in ใหม่ ถ้าจะใช้จริงต้อง Publish ก่อน

ส่ง verify ได้ที่ OAuth consent screen → **Publish app** → **Prepare for verification**:

- ต้องมีหน้านโยบายความเป็นส่วนตัวที่บอกว่าใช้สิทธิ์ปฏิทินทำอะไร (เพิ่ม แก้ และลบเฉพาะกิจกรรมของเตือนที่ผู้ใช้เลือก)
- อาจต้องมีวิดีโอสาธิตการใช้งาน
- ใช้เวลาหลายวันถึงหลายสัปดาห์

## ทำงานยังไง (สรุป)

- Google ไม่ยอมให้ sign in ในเบราว์เซอร์ของไลน์ ขั้นนี้จึงเปิดใน Safari/Chrome:
  - ลิงก์ที่เปิดมีอายุ 15 นาที
  - หน้าแรกบอกชื่อเจ้าของบัญชีพี่ฮูกก่อนไปหน้า Google
- เสร็จแล้วกลับมาที่ไลน์ด้วยปุ่ม "กลับไปที่ไลน์"
- เก็บ refresh token แบบเข้ารหัส AES-GCM ในตาราง `google_calendar_links` ซึ่งเปิด RLS ไว้และไม่มี policy ใช้ได้เฉพาะฝั่งเซิร์ฟเวอร์
- ซิงก์กับกิจกรรมใน Google:
  - แก้, เลื่อน หรือเลื่อนเตือน (snooze) → แก้กิจกรรมตาม
  - ยกเลิกเตือน → ลบกิจกรรม
  - ผู้ใช้ลบกิจกรรมใน Google เอง → ไม่เพิ่มกลับ
- Google ล่มหรือผู้ใช้ถอนสิทธิ์ → ตัวเตือนเองยังทำงานปกติ ถ้าถอนสิทธิ์ ครั้งหน้าจะขอให้ sign in ใหม่
- ลิงก์ sign in ใช้ได้ครั้งเดียว พอเชื่อมเสร็จ บอทจะส่งข้อความในไลน์บอกอีเมลที่เชื่อม (ถ้าไม่ได้ทำเอง ยกเลิกได้ในหน้าตั้งค่า)
- เตือนประจำ: ถ้าแก้แค่ข้อความ จะเปลี่ยนแค่ชื่อกิจกรรม แต่ถ้าแก้เวลาหรือการทำซ้ำ กิจกรรมทั้งชุดจะเริ่มใหม่จากรอบถัดไป (รอบเก่าในปฏิทินจะหายไป) ส่วนการข้ามรอบจะลบเฉพาะรอบนั้นออกจากปฏิทิน
- ลบบัญชี → คืนสิทธิ์ Google ให้ก่อนลบ
- เตือนกลุ่มยังใช้ปุ่ม 📅 Google / 📅 iPhone เดิม
