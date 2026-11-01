# ที่ฝากไฟล์ R2 (เฟส 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ผู้ใช้ส่งรูป เอกสาร หรือวิดีโอในแชท 1:1 ให้พี่ฮูกเก็บไว้ใน R2 ตามโควตาของแผน แล้วค้น เปิด เปลี่ยนชื่อ และลบได้

**Architecture:** ข้อมูลไฟล์อยู่ใน Supabase ส่วนตัวไฟล์อยู่ใน bucket ส่วนตัว `phook-files` ผ่าน interface `FileStore` บริการ `saveFile` เป็นทางเดียวที่เขียนไฟล์ ส่วน LINE, คำสั่ง, ตัวแยกกลุ่ม AI และปุ่มกดเรียกใช้บริการนี้ทั้งหมด

**Tech Stack:** TypeScript strict, Next.js 15, Supabase, Cloudflare R2 binding, `@opennextjs/cloudflare`, jose, vitest, PGlite, Playwright

**Spec:** `docs/superpowers/specs/2026-11-01-ai-router-and-file-storage-design.md` (หัวข้อ 4)

## Global Constraints

- โควตา: Free 500 MB, Pro 5 GB, Elite 50 GB, ไฟล์ละไม่เกิน 20 MB
- ไม่รับ `.exe`, `.apk`, `.msi`, `.bat`, `.sh`
- ไฟล์ล่าสุดจำไว้ 30 นาที, การรอเก็บไฟล์ 5 นาที, ลิงก์ดาวน์โหลด 10 นาที
- Bucket `phook-files` เป็นส่วนตัว, binding `FILES`, key `u/<userId>/<uuid>`
- ไม่ส่งเนื้อหาไฟล์ให้ AI ยกเว้นสลิปหรือ PDF ที่ผู้ใช้เลือกอ่าน
- UI ภาษาไทย รองรับ 360px และมีสถานะ loading, empty, error
- Migration แบบ additive และ idempotent
- Commit ลงท้าย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- ห้าม push จนกว่าเจ้าของจะสั่ง
- ทำบน branch `feat/r2-files` เพราะ push ขึ้น `main` จะ deploy ทันที

**สิ่งที่ปรับจาก spec:**

- **ลำดับการเก็บ:** โหลดจาก LINE ก่อน แล้วค่อยจองพื้นที่ เพราะรูปจาก LINE ไม่บอกขนาดล่วงหน้า ถ้าจองก่อน คนที่เหลือพื้นที่น้อยจะถูกปฏิเสธรูปเล็กโดยไม่จำเป็น
- **ไฟล์ล่าสุด:** เก็บได้หลายแถว และ "เก็บไว้" เก็บทุกไฟล์ที่ค้างอยู่ สูงสุด 5 ไฟล์ เพราะคนมักส่งรูปหลายรูปติดกัน
- **การตั้งชื่อรูป:** บอทบอกวิธีตั้งชื่อบนการ์ด แล้วรับคำสั่ง `ชื่อไฟล์ <ชื่อ>` แทนการรอข้อความถัดไป ข้อความทั่วไปจึงไม่ต้องอ่านฐานข้อมูลเพิ่ม
- **รีเซ็ตข้อมูล:** ไม่ลบไฟล์ เพราะ `data_erase` ลบเฉพาะข้อมูลเงิน ไม่แตะโน้ตและเตือน จะแก้เฉพาะ `src/lib/account.ts`
- **คำสั่งตรง:** เพิ่ม `เก็บไฟล์`, `หาไฟล์`, `ไฟล์ของฉัน` เพื่อให้ใช้ได้เมื่อ AI ล่มหรือโควตาหมด
- **เพดานต่อวัน:** Free 20, Pro 100, Elite 200 ไฟล์ นับด้วย `takeUsage`

## Review Focus

1. ส่งรูป 3 รูปติดกันแล้วพิมพ์ "เก็บไว้ให้หน่อย" ต้องเก็บครบ 3 รูป และกดซ้ำต้องไม่เก็บซ้ำ (Task 4)
2. ส่งไฟล์พร้อมกันจนเกินโควตา ต้องเกินเพดานไม่ได้ และไฟล์ที่ล้มเหลวต้องไม่กินพื้นที่ (Task 1 และ 3)
3. ชื่อไฟล์แปลก เช่นมีเครื่องหมายคำพูด ขึ้นบรรทัดใหม่ หรือภาษาไทยล้วน ต้องดาวน์โหลดได้ชื่อถูกและแทรก header ไม่ได้ (Task 6)
4. ผู้ใช้อื่นถือลิงก์ที่หมดอายุหรือแก้ id ในลิงก์ ต้องเปิดไม่ได้ (Task 6)
5. ลบบัญชีตอน R2 ล่ม ต้องล้มเหลวทั้งหมดเพื่อให้ลองใหม่ได้ ไม่ทิ้งไฟล์กำพร้า (Task 8)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/file.ts` | โควตา, ตรวจชนิดไฟล์, ชื่อไฟล์, DTO |
| `src/lib/file-store.ts` | interface `FileStore` และตัวจริงที่ใช้ R2 |
| `src/lib/file-repo.ts` | อ่าน/เขียน `stored_files`, `file_waits`, `recent_media` |
| `src/lib/file-save.ts` | บริการ `saveFile` |
| `src/lib/line/file-handlers.ts` | เหตุการณ์ไฟล์จาก LINE, ปุ่ม, คำสั่ง |
| `src/lib/line/file-flex.ts` | การ์ดไฟล์ |
| `src/lib/auth/file-token.ts` | token ดาวน์โหลด |
| `src/app/api/files/**` | API รายการ, แก้ชื่อ, ลบ, ลิงก์, ดาวน์โหลด |
| `src/app/(liff)/files/page.tsx` | หน้าไฟล์ |
| `supabase/migrations/0047_stored_files.sql` | ตารางและ `file_reserve` |

---

### Task 1: โควตา กฎไฟล์ และฐานข้อมูล

**Files:**
- Create: `src/lib/file.ts`, `src/lib/file.test.ts`, `supabase/migrations/0047_stored_files.sql`, `src/lib/file-repo.ts`, `src/lib/file-repo.test.ts`
- Modify: `src/lib/usage.ts`, `tests/db/migrations.test.ts`

**Interfaces:**
- Produces:

```ts
// src/lib/file.ts
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_NAME_LENGTH = 200;
export const fileCapacity: (plan: Plan) => number; // 500 MiB, 5 GiB, 50 GiB
export const fileDayLimit: (plan: Plan) => number; // 20, 100, 200
export function isBlockedFile(name: string): boolean;
export function cleanFileName(raw: string): string;
export function defaultFileName(kind: MediaKind, now: Date): string; // "รูป 1 พ.ย. 2569 19:30"
export type MediaKind = "image" | "video" | "file";
export interface FileDto { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: string }

// src/lib/file-repo.ts
export interface RecentMedia { id: string; messageId: string; kind: MediaKind; fileName: string | null; fileSize: number | null }
export async function reserveFile(db, input: { id: string; userId: string; name: string; mimeType: string; sizeBytes: number; r2Key: string; capacity: number }): Promise<boolean>;
export async function markFileReady(db, userId: string, id: string): Promise<void>;
export async function dropFileRow(db, userId: string, id: string): Promise<void>;
export async function getReadyFile(db, userId: string, id: string): Promise<(FileDto & { r2Key: string }) | null>;
export async function listFiles(db, userId: string, options?: { q?: string; before?: string; limit?: number }): Promise<{ items: FileDto[]; hasMore: boolean }>;
export async function renameFile(db, userId: string, id: string, name: string): Promise<boolean>;
export async function renameLatestFile(db, userId: string, name: string): Promise<FileDto | null>;
export async function fileUsage(db, userId: string): Promise<number>;
export async function listAllKeys(db, userId: string): Promise<string[]>;
export async function listStalePending(db, before: Date, limit?: number): Promise<{ id: string; userId: string; r2Key: string }[]>;
export async function startFileWait(db, userId: string, name: string | null, now: Date): Promise<void>; // 5 minutes
export async function takeFileWait(db, userId: string, now: Date): Promise<{ name: string | null } | null>;
export async function rememberMedia(db, userId: string, media: Omit<RecentMedia, "id">, now: Date): Promise<string>; // 30 minutes
export async function takeRecentMedia(db, userId: string, now: Date, limit?: number): Promise<RecentMedia[]>; // oldest first, default 5
export async function takeMediaById(db, userId: string, id: string, now: Date): Promise<RecentMedia | null>;
export async function purgeExpiredMedia(db, now: Date): Promise<void>;
```

`usage.ts`: เพิ่ม `"file_save"` ใน `UsageKind`

- [ ] **Step 1: เขียนเทสต์ `src/lib/file.test.ts`**

```ts
it.each(["setup.exe", "APP.APK", "x.msi", "run.bat", "a.b.sh", " tool.exe "])("blocks %s", (n) => expect(isBlockedFile(n)).toBe(true));
it.each(["สัญญาเช่า.pdf", "photo.jpg", "exe", "notes.exe.txt"])("allows %s", (n) => expect(isBlockedFile(n)).toBe(false));
it("gives each plan its space", () => {
  expect(fileCapacity("free")).toBe(500 * 1024 * 1024);
  expect(fileCapacity("plus")).toBe(5 * 1024 ** 3);
  expect(fileCapacity("ultimate")).toBe(50 * 1024 ** 3);
});
it("gives each plan its daily number", () => expect(["free", "plus", "ultimate"].map(fileDayLimit)).toEqual([20, 100, 200]));
it("tidies a name", () => expect(cleanFileName('  a\n"b"\t.pdf  ')).toBe('a "b" .pdf'));
it("keeps the extension when cutting a long name", () => {
  const n = cleanFileName(`${"ก".repeat(300)}.pdf`);
  expect(n).toHaveLength(MAX_NAME_LENGTH);
  expect(n.endsWith(".pdf")).toBe(true);
});
it("names a picture by its time in Bangkok", () =>
  expect(defaultFileName("image", new Date("2026-11-01T12:30:00Z"))).toBe("รูป 1 พ.ย. 2569 19:30"));
```

- [ ] **Step 2: เขียนเทสต์ฐานข้อมูลใน `tests/db/migrations.test.ts`**

```ts
describe("stored files (0047)", () => {
  it("file_reserve stops at the capacity");            // 60 + 50 over capacity 100: second returns false, no row
  it("file_reserve counts pending rows too");          // pending 60 then 50 over 100 is refused
  it("files of another person do not count");
  it("keeps every table server only");                 // RLS on, no policies, for all 3 tables
  it("removes the rows with the user");
  it("refuses a name that is too long");
});
```

- [ ] **Step 3: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/file.test.ts tests/db/migrations.test.ts`
Expected: FAIL

- [ ] **Step 4: เขียน migration 0047**

```sql
create table if not exists stored_files (
  id uuid primary key, user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  mime_type text not null, size_bytes bigint not null check (size_bytes > 0),
  r2_key text not null unique, status text not null default 'pending' check (status in ('pending','ready')),
  created_at timestamptz not null default now()
);
create table if not exists file_waits (user_id uuid primary key references users(id) on delete cascade, name text, expires_at timestamptz not null);
create table if not exists recent_media (
  id uuid primary key, user_id uuid not null references users(id) on delete cascade,
  message_id text not null, kind text not null check (kind in ('image','video','file')),
  file_name text, file_size bigint, expires_at timestamptz not null, created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
```

เพิ่ม index `(user_id, created_at desc)` บน `stored_files` และ `(status, created_at)` เปิด RLS ทุกตารางโดยไม่มี policy

`file_reserve(p_id, p_user, p_name, p_mime, p_size, p_key, p_capacity bigint) returns boolean` ใช้ `perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0))` แล้วรวม `size_bytes` ทุกแถวของผู้ใช้ ถ้าเกินคืน false ถ้าไม่เกิน insert แถว `pending` แล้ว `revoke execute ... from public, anon, authenticated`

- [ ] **Step 5: เขียน `file.ts` และ `file-repo.ts`**

- `takeRecentMedia` และ `takeMediaById` ใช้ `delete().select()` เพื่อให้หยิบได้ครั้งเดียว
- `listFiles`, `getReadyFile`, `fileUsage` ใช้ `escapeLike` เดิม และ `listFiles`, `getReadyFile` เห็นเฉพาะ `status = 'ready'`
- `fileUsage` รวมทุกสถานะ ให้ตรงกับ `file_reserve`
- `renameLatestFile` เลือกแถว `ready` ล่าสุดของผู้ใช้

เขียน `file-repo.test.ts` ด้วย fake chain แบบ `pending-intent-repo.test.ts` ให้ครอบ: กรอง `user_id` ทุกฟังก์ชัน, `takeFileWait` กรองหมดอายุ, `takeRecentMedia` เรียงเก่าไปใหม่

- [ ] **Step 6: รันให้ผ่าน แล้ว commit**

Run: `corepack pnpm exec vitest run src/lib/file.test.ts src/lib/file-repo.test.ts tests/db/migrations.test.ts`
Expected: PASS

```bash
git add src/lib/file.ts src/lib/file.test.ts src/lib/file-repo.ts src/lib/file-repo.test.ts src/lib/usage.ts supabase/migrations/0047_stored_files.sql tests/db/migrations.test.ts
git commit -m "feat(files): quotas, rules and tables for stored files"
```

### Task 2: ที่เก็บ R2 และการโหลดจาก LINE

**Files:**
- Create: `src/lib/file-store.ts`, `src/lib/file-store.test.ts`
- Modify: `src/lib/line/content.ts`, `src/lib/line/content.pdf.test.ts`, `wrangler.jsonc`

**Interfaces:**
- Produces:

```ts
// src/lib/file-store.ts
export interface StoredObject { body: ReadableStream; size: number }
export interface FileStore {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string[]): Promise<void>;
}
export interface R2Like { put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>; get(key: string): Promise<{ body: ReadableStream; size: number } | null>; delete(keys: string | string[]): Promise<void> }
export function createR2Store(bucket: R2Like): FileStore;
export function createMemoryStore(): FileStore & { keys(): string[] };
export async function getFileStore(): Promise<FileStore | null>; // null where no binding exists

// src/lib/line/content.ts
export async function fetchLineFile(accessToken: string, messageId: string, fetchImpl?: typeof fetch): Promise<{ bytes: Uint8Array; mimeType: string }>;
```

- [ ] **Step 1: เขียนเทสต์**

```ts
it("r2: stores with the content type", ...);        // put received httpMetadata.contentType
it("r2: deletes in batches of 1000", ...);          // 2500 keys make 3 calls
it("r2: does nothing for no keys", ...);
it("r2: passes a missing object on as null", ...);
it("getFileStore is null without the binding", ...); // outside Workers, never throws
```

เพิ่มใน `content.pdf.test.ts`:

```ts
it("fetchLineFile refuses a declared size over 20 MB before reading", ...);  // ImageError too_large
it("fetchLineFile refuses an actual size over 20 MB", ...);
it("fetchLineFile falls back to application/octet-stream", ...);
it("fetchLineFile fails on an empty file", ...);                            // ImageError download_failed
it("fetchLineFile says gone when LINE no longer has it", ...);              // 404 or 410: ImageError gone
```

เพิ่ม `"gone"` ในเหตุผลของ `ImageError`

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/file-store.test.ts src/lib/line/content.pdf.test.ts`
Expected: FAIL

- [ ] **Step 3: เขียนโค้ด**

- `getFileStore` ใช้ `getCloudflareContext({ async: true })` จาก `@opennextjs/cloudflare` อ่าน `env.FILES` ครอบ try/catch แล้วคืน null เมื่อไม่มี
- `fetchLineFile` ใช้ timeout 20 วินาทีแบบ `fetchLineImage`
- เพิ่มใน `wrangler.jsonc`: `"r2_buckets": [{ "binding": "FILES", "bucket_name": "phook-files" }]`

- [ ] **Step 4: รันให้ผ่าน แล้วตรวจ wrangler**

Run: `corepack pnpm exec vitest run src/lib/file-store.test.ts src/lib/line/content.pdf.test.ts src/portability.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/file-store.ts src/lib/file-store.test.ts src/lib/line/content.ts src/lib/line/content.pdf.test.ts wrangler.jsonc
git commit -m "feat(files): R2 store and LINE file download"
```

### Task 3: บริการเก็บไฟล์

**Files:**
- Create: `src/lib/file-save.ts`, `src/lib/file-save.test.ts`

**Interfaces:**
- Consumes: Task 1 และ Task 2
- Produces:

```ts
export type SaveFailure = "blocked" | "too_large" | "day_limit" | "full" | "gone" | "failed" | "unavailable";
export type SaveResult = { ok: true; file: FileDto } | { ok: false; reason: SaveFailure };
export interface SaveDeps {
  db: SupabaseClient; now: () => Date; store: FileStore | null;
  fetchFile: (messageId: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
}
export async function saveFile(deps: SaveDeps, user: UserRow, media: Omit<RecentMedia, "id">, name: string | null): Promise<SaveResult>;
```

- [ ] **Step 1: เขียนเทสต์ `file-save.test.ts`**

ใช้ `createMemoryStore` และ mock `@/lib/file-repo`, `@/lib/usage`

```ts
it("downloads, reserves, writes, then marks ready");     // call order, key matches /^u\/u1\/[0-9a-f-]{36}$/
it("uses the given name, else the file name, else a default");
it("keeps the extension of the real file when given a name"); // "สัญญา" + a.pdf is "สัญญา.pdf"
it("refuses a blocked file before downloading");
it("refuses a declared size over 20 MB before downloading");
it("says full and writes nothing when the reserve fails");
it("drops the row when the write fails");                 // dropFileRow called, reason failed
it("gives the day's use back when it fails");
it("says gone when LINE no longer has the content");      // fetchFile rejects with ImageError gone
it("still refuses when a plan was lowered below the space used"); // reserve false gives full
it("says unavailable without a store");                   // no download, no use taken
it("takes the day's use by plan");                        // takeUsage(db, id, "file_save", 20, day)
```

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/file-save.test.ts`
Expected: FAIL

- [ ] **Step 3: เขียน `saveFile`**

ลำดับ: ตรวจ store, ตรวจชื่อและขนาดที่แจ้ง, `takeUsage`, โหลดจาก LINE, `reserveFile`, `store.put`, `markFileReady` ถ้าล้มเหลวหลัง reserve ให้ลบแถวและคืน `refundUsage`

- [ ] **Step 4: รันให้ผ่าน แล้ว commit**

Run: `corepack pnpm exec vitest run src/lib/file-save.test.ts`
Expected: PASS

```bash
git add src/lib/file-save.ts src/lib/file-save.test.ts
git commit -m "feat(files): the service that saves a file"
```

### Task 4: รับไฟล์จากแชท LINE

**Files:**
- Create: `src/lib/line/file-handlers.ts`, `src/lib/line/file-flex.ts`, `src/lib/line/handlers.files.test.ts`
- Modify: `src/lib/line/handlers.ts:376-390,425-520,2305+`, `src/lib/slips.ts:51-66,166`, `src/lib/line/process.ts`, `src/lib/commands.ts`, `src/lib/commands.test.ts`, `src/lib/line/messages.ts`, `src/lib/ai/intent-router.ts`, `src/lib/ai/route-text.ts`, `src/lib/line/intent-handlers.ts`, `scripts/eval-router.ts`

**Interfaces:**
- Consumes: `saveFile`, repo จาก Task 1
- Produces:

```ts
// commands
| { kind: "file-save"; name: string | null }   // "เก็บไฟล์", "เก็บไฟล์ สัญญาเช่า"
| { kind: "file-search"; term: string }        // "หาไฟล์ สัญญา"
| { kind: "file-list" }                        // "ไฟล์ของฉัน"
| { kind: "file-rename"; name: string }        // "ชื่อไฟล์ รูปบัตร"
| { kind: "kept-search"; term: string }        // router only: notes and files

// SlipDeps
onNotSlip?: () => Promise<LineMessage[]>;      // replaces NOT_A_SLIP_TEXT

// file-handlers.ts
export interface FileChatDeps extends SaveDeps { pageUrl: (path: string) => string | undefined }
export function handleIncomingFile(deps: FileChatDeps, user: UserRow, media: Omit<RecentMedia, "id">, kind: "pdf" | "other"): Promise<LineMessage[]>;
export function saveWaitingFile(deps: FileChatDeps, user: UserRow, media: Omit<RecentMedia, "id">, name: string | null): Promise<LineMessage[]>;
export function offerToKeep(deps: FileChatDeps, user: UserRow, media: Omit<RecentMedia, "id">): Promise<LineMessage[]>;
export function runFileSave(deps: FileChatDeps, user: UserRow, name: string | null): Promise<LineMessage[]>;
export function handleFilePick(deps: FileChatDeps, user: UserRow, action: "fsv" | "frd", id: string, readPdf: (m: RecentMedia) => Promise<LineMessage[]>): Promise<LineMessage[]>;
```

Postback: `a=fsv&id=<recentId>` เก็บไฟล์, `a=frd&id=<recentId>` อ่าน PDF เป็นรายการ

- [ ] **Step 1: เขียนเทสต์ `handlers.files.test.ts`**

| เทสต์ | สถานการณ์ | สิ่งที่ assert |
|---|---|---|
| `a waiting save beats the slip reader` | `file_waits` มีอยู่, ส่งรูป | `saveFile` ถูกเรียก, `ocr` ไม่ถูกเรียก |
| `a photo wait beats the file wait` | `photo_waits` มีอยู่ | แนบกับรายการตามเดิม |
| `an image still reads as a slip` | ไม่มีการรอ | อ่านสลิป, จำไฟล์ล่าสุด |
| `a picture that is no slip offers to keep it` | OCR ตอบ `not_slip` | มีปุ่ม `a=fsv&id=` |
| `a PDF asks first and calls no AI` | ส่ง PDF | ปุ่ม "เก็บไฟล์" (`fsv`) และ "อ่านเป็นรายการ" (`frd`) ตามลำดับนี้, `reader` ไม่ถูกเรียก |
| `reading a PDF from its button` | postback `frd` | `handlePdfMessage` ได้ชื่อและขนาดเดิม |
| `a document offers to keep it` | `.docx` | ปุ่ม `fsv` |
| `a video offers to keep it` | video | ปุ่ม `fsv` |
| `a video kept elsewhere is left alone` | `contentProvider.type = "external"` | ตอบว่ารับไม่ได้ |
| `a blocked file is refused` | `.exe` | ตอบ `FILE_BLOCKED_TEXT`, ไม่จำไฟล์ |
| `voice still records money` | audio | `handleVoiceMessage` ถูกเรียก |
| `"เก็บไว้" keeps everything waiting` | ค้าง 3 รูป | `saveFile` 3 ครั้ง, การ์ดสรุป 3 ไฟล์ |
| `a name is numbered across several files` | `เก็บไฟล์ บัตร`, ค้าง 2 รูป | ชื่อ `บัตร 1`, `บัตร 2` |
| `nothing waiting opens the 5 minute wait` | ไม่มีไฟล์ค้าง | `startFileWait`, ตอบให้ส่งไฟล์ |
| `a second tap saves nothing` | `takeMediaById` คืน null | ตอบ `FILE_EXPIRED_TEXT` |
| `a full space says so` | `saveFile` ตอบ `full` | ตอบ `FILE_FULL_TEXT` พร้อมเพดานของแผน |
| `the content is gone` | `saveFile` ตอบ `gone` | ตอบให้ส่งใหม่ และเปิดการรอ |
| `a saved picture says how to name it` | รูปไม่มีชื่อ | การ์ดมีข้อความ `ชื่อไฟล์` |
| `renames the latest file` | `ชื่อไฟล์ รูปบัตร` | `renameLatestFile` |
| `a sorted message saves too` | AI ตอบ `file_save` `fileName:"บัตร"` | `runFileSave` ได้ชื่อ `บัตร` |
| `the file words reach the router` | "เก็บรูปบัตร 2 ใบ" | `needsRouter` เป็น true |

เพิ่มใน `commands.test.ts` ครอบทั้ง 4 คำสั่ง และ `"ไฟล์ 500"` ยังเป็นรายการเงิน

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/line/handlers.files.test.ts src/lib/commands.test.ts`
Expected: FAIL

- [ ] **Step 3: แก้ `slips.ts` และ `commands.ts`**

เพิ่ม `onNotSlip` และใช้แทน `NOT_A_SLIP_TEXT` เฉพาะ `reason === "not_slip"`

- [ ] **Step 4: เขียน `file-handlers.ts` และ `file-flex.ts`**

- `runFileSave`: `takeRecentMedia` ถ้าว่างใช้ `startFileWait` ถ้ามีหลายไฟล์ใส่เลขต่อท้ายชื่อ
- การ์ดสูงสุด 5 ใบ มีปุ่ม URI ไปที่ `pageUrl("/files?open=<id>")`
- ข้อความใหม่ใน `messages.ts`: `FILE_BLOCKED_TEXT`, `FILE_TOO_LARGE_TEXT`, `FILE_FULL_TEXT`, `FILE_DAY_LIMIT_TEXT`, `FILE_GONE_TEXT`, `FILE_FAILED_TEXT`, `FILE_UNAVAILABLE_TEXT`, `FILE_EXPIRED_TEXT`, `FILE_SEND_NOW_TEXT`, `FILE_ASK_KEEP_TEXT`, `FILE_NOT_FOUND_TEXT`, `fileNamingHintText`

- [ ] **Step 5: ต่อเข้ากับ `handlers.ts`**

ลำดับใน `handleEvent` สำหรับ image: `photo_waits`, `takeFileWait`, `rememberMedia` แล้วอ่านสลิป

สำหรับ file: `takeFileWait`, `isBlockedFile`, แล้วแยก PDF กับไฟล์อื่น ไม่เรียก `handlePdfMessage` จนกว่าจะกดปุ่ม `frd`

สำหรับ video: นับใน bucket `chat_image` และรับเฉพาะ `contentProvider.type === "line"` เพิ่ม `contentProvider` ใน `LineEvent`

เพิ่ม deps `files?: { fetchFile; store: FileStore | null }` ใน `HandlerDeps` และตั้งค่าใน `process.ts` ถ้า `files` ไม่มี ให้ทำงานแบบเดิมทุกอย่าง

- [ ] **Step 6: เพิ่มในตัวแยกกลุ่ม**

- `RoutedIntent` เพิ่ม `file_save`, `IntentDecision` เพิ่ม `fileName: string | null`
- prompt เพิ่ม `file_save: wants a file or picture they sent kept. "เก็บไว้ให้หน่อย", "ฝากรูปนี้ด้วย"`
- `search` ใน `execute` เปลี่ยนเป็น `{ kind: "kept-search", term }`
- `route-text.ts` เพิ่ม `/เก็บ(?:ไฟล์|รูป|เอกสาร|วิดีโอ)|หา(?:ไฟล์|รูป)/` ใน `KEEP_RE`
- `eval-router.ts` เพิ่ม `เก็บไว้ให้หน่อย`, `ฝากรูปนี้ไว้ด้วย` คาดหวัง `file_save` และ `หาไฟล์สัญญาเช่าให้หน่อย` คาดหวัง `search`

- [ ] **Step 7: รันให้ผ่าน แล้ว commit**

Run: `corepack pnpm exec vitest run src/lib/line src/lib/ai src/lib/commands.test.ts`
Expected: PASS ทั้งเทสต์ใหม่และเดิม

```bash
git add src/lib scripts/eval-router.ts
git commit -m "feat(line): keep files sent in the chat"
```

### Task 5: ค้นหาและรายการไฟล์ในแชท

**Files:**
- Modify: `src/lib/line/file-handlers.ts`, `src/lib/line/file-flex.ts`, `src/lib/line/handlers.ts`, `src/lib/line/handlers.files.test.ts`

**Interfaces:**
- Consumes: `listFiles`, `listNotes`
- Produces: `runFileSearch(deps, user, term, withNotes: boolean): Promise<LineMessage[]>`, `runFileList(deps, user): Promise<LineMessage[]>`

- [ ] **Step 1: เขียนเทสต์ใน `handlers.files.test.ts`**

```ts
it("หาไฟล์ finds by name and shows at most 5 cards");
it("kept-search answers with notes and files together");
it("kept-search with notes only stays the note answer");
it("says so when nothing is found");
it("ไฟล์ของฉัน shows the latest with the space used");   // "ใช้ไป 12 MB จาก 500 MB"
```

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/line/handlers.files.test.ts`
Expected: FAIL

- [ ] **Step 3: เขียน `runFileSearch` และ `runFileList`**

เพิ่ม `formatBytes(n: number): string` ใน `src/lib/file.ts` พร้อมเทสต์ `512 KB`, `12 MB`, `1.5 GB`

- [ ] **Step 4: รันให้ผ่าน แล้ว commit**

Run: `corepack pnpm exec vitest run src/lib/line src/lib/file.test.ts`
Expected: PASS

```bash
git add src/lib
git commit -m "feat(line): find kept files from the chat"
```

### Task 6: API ไฟล์และการดาวน์โหลด

**Files:**
- Create: `src/lib/auth/file-token.ts`, `src/lib/auth/file-token.test.ts`, `src/app/api/files/route.ts`, `src/app/api/files/route.test.ts`, `src/app/api/files/[id]/route.ts`, `src/app/api/files/[id]/link/route.ts`, `src/app/api/files/[id]/download/route.ts`, `src/app/api/files/[id]/download/route.test.ts`
- Modify: `src/lib/rate-limit.ts`, `src/lib/file.ts`

**Interfaces:**
- Consumes: repo, `getFileStore`
- Produces:

```ts
export const FILE_LINK_TTL_SECONDS = 600;
export async function signFileToken(claims: { userId: string; fileId: string }, secret: string, now?: Date): Promise<string>;
export async function verifyFileToken(token: string, secret: string, now?: Date): Promise<{ userId: string; fileId: string } | null>;
export function contentDisposition(name: string): string;
```

| Route | ผลลัพธ์ |
|---|---|
| `GET /api/files?q=&before=` | `{ items, hasMore, usedBytes, capacityBytes }` |
| `PATCH /api/files/[id]` `{ name }` | แก้ชื่อ |
| `DELETE /api/files/[id]` | ลบ R2 ก่อน แล้วลบแถว |
| `POST /api/files/[id]/link` | `{ url }` อายุ 10 นาที |
| `GET /api/files/[id]/download?t=` | ไฟล์ |

- [ ] **Step 1: เขียนเทสต์**

```ts
// file-token.test.ts
it("round trips"); it("expires after 10 minutes"); it("refuses an export token"); it("refuses another secret");

// download/route.test.ts
it("sends the file as a download", ...);   // attachment, nosniff, CSP sandbox, Cache-Control private no-store
it("refuses an expired token");            // 401
it("refuses a token for another file");    // id in the path differs from the claim: 403
it("is 404 for a file that is not theirs");
it("is 404 when the object has gone");

// contentDisposition
it("keeps a Thai name", () => expect(contentDisposition("สัญญา.pdf")).toContain("filename*=UTF-8''%E0%B8%AA"));
it("cannot break the header", () => expect(contentDisposition('a"\r\nX: y.pdf')).not.toMatch(/[\r\n]/));

// files/route.test.ts
it("lists with the space used"); it("needs a session");
```

เพิ่มเทสต์ `[id]/route`: ลบต้องเรียก `store.delete` ก่อน และถ้า R2 ล้มเหลวต้องไม่ลบแถว แก้ชื่อใช้ `cleanFileName` และชื่อว่างตอบ 400

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/auth/file-token.test.ts src/app/api/files`
Expected: FAIL

- [ ] **Step 3: เขียนโค้ด**

- token ใช้ audience `phook-file` ตามแบบ `export-token.ts` ใช้ `SESSION_JWT_SECRET` เดิม
- เพิ่ม `LIMITS.fileLink: { limit: 20, windowSeconds: 60 }`
- `link` เช็กเจ้าของด้วย `getReadyFile` ก่อนออก token
- `download` ส่ง `object.body` เป็น stream

- [ ] **Step 4: รันให้ผ่าน แล้ว commit**

Run: `corepack pnpm exec vitest run src/lib/auth/file-token.test.ts src/app/api/files`
Expected: PASS

```bash
git add src/lib src/app/api/files
git commit -m "feat(files): API for the files page and private downloads"
```

### Task 7: หน้าไฟล์

**Files:**
- Create: `src/app/(liff)/files/page.tsx`, `tests/e2e/files.spec.ts`
- Modify: `src/app/(liff)/notes/page.tsx`

**Interfaces:**
- Consumes: API จาก Task 6, `useApi`, `useLiff().openExternal`, `formatBytes`

- [ ] **Step 1: เขียน `tests/e2e/files.spec.ts` ตามแบบไฟล์ e2e เดิมที่ 360px**

```ts
test("shows the space used and the files");
test("shows the empty state with how to keep a file");
test("shows the error state with retry");
test("searches by name");
test("renames a file");
test("deletes after confirming");
test("?open=<id> asks for the link and opens it outside LINE");
test("no horizontal scroll at 360px");
```

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec playwright test tests/e2e/files.spec.ts`
Expected: FAIL

- [ ] **Step 3: เขียนหน้า `/files`**

ใช้ `Suspense`, `Sheet`, `EmptyState`, `ErrorState`, `LoadingBlock`, `PageHeader` แบบหน้าโน้ต แถบพื้นที่แสดง `formatBytes(used)` จาก `formatBytes(capacity)` และเพิ่มลิงก์ "ไฟล์ที่ฝากไว้" ในหัวหน้าโน้ต

- [ ] **Step 4: รันให้ผ่าน แล้ว commit**

Run: `corepack pnpm exec playwright test tests/e2e/files.spec.ts`
Expected: PASS

```bash
git add "src/app/(liff)/files" "src/app/(liff)/notes/page.tsx" tests/e2e/files.spec.ts
git commit -m "feat(files): the files page"
```

### Task 8: ลบบัญชี งานทำความสะอาด เอกสาร และการตรวจจริง

**Files:**
- Modify: `src/lib/account.ts`, `src/lib/account.test.ts`, `src/app/api/cron/reminders/route.ts`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/lib/line/help-flex.ts`, `docs/DEPLOY.md`, `docs/PROJECT-STATUS.md`
- Create: `src/lib/file-cleanup.ts`, `src/lib/file-cleanup.test.ts`

**Interfaces:**
- Consumes: `listAllKeys`, `listStalePending`, `dropFileRow`, `purgeExpiredMedia`, `getFileStore`
- Produces: `cleanupFiles(db, store: FileStore | null, now: Date): Promise<{ removed: number }>`

- [ ] **Step 1: เขียนเทสต์**

```ts
it("account deletion removes their R2 files first");
it("account deletion stops when R2 fails, so the account stays and can retry");
it("account deletion stops when the store is missing but files exist");
it("account deletion needs no store when there are no files");
it("cleanup removes pending rows over an hour old, object first");
it("cleanup leaves fresh pending rows");
it("cleanup purges expired recent media");
```

- [ ] **Step 2: รันให้ล้มเหลว**

Run: `corepack pnpm exec vitest run src/lib/file-cleanup.test.ts src/lib/account.test.ts`
Expected: FAIL

- [ ] **Step 3: เขียนโค้ด**

- เพิ่ม `cleanupFiles` ใน cron รายชั่วโมงแบบ best effort เหมือน `purgeExpiredIntents`
- หน้านโยบาย: ไฟล์เก็บบน Cloudflare R2 ไม่ส่งให้ AI ยกเว้นที่ผู้ใช้เลือกอ่าน และลบได้เองหรือเมื่อลบบัญชี
- หน้าข้อกำหนด: ห้ามฝากเนื้อหาผิดกฎหมาย ควรมีสำเนาไฟล์สำคัญไว้เอง
- การ์ดวิธีใช้: เพิ่มเรื่องฝากไฟล์ ถ้าเปลี่ยนรูปให้เพิ่มเลข `v=`
- `docs/DEPLOY.md`: เพิ่มขั้นตอนสร้าง bucket และรัน 0047 ก่อน push
- `docs/PROJECT-STATUS.md`: เพิ่มแถว 0047

- [ ] **Step 4: รันชุดตรวจทั้งหมด**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm exec eslint . && corepack pnpm exec vitest run && corepack pnpm exec playwright test`
Expected: ผ่านทั้งหมด

- [ ] **Step 5: รันวัดผลกับ AI จริง**

Run: `corepack pnpm exec tsx scripts/eval-router.ts`
Expected: ผิดไม่เกิน 1 ข้อ ถ้าเจอ 429 ให้เว้นช่วงแล้วรันใหม่

- [ ] **Step 6: ตรวจ build ของ Cloudflare**

Run: `corepack pnpm run cf:build && corepack pnpm exec wrangler deploy --dry-run`
Expected: ผ่าน และแสดง binding `FILES`

- [ ] **Step 7: Commit**

```bash
git add src docs
git commit -m "feat(files): account deletion, cleanup and docs"
```

- [ ] **Step 8: ขออนุมัติและส่งมอบ**

หยุดเพื่อขออนุมัติก่อนรัน `wrangler r2 bucket create phook-files` แจ้งเจ้าของให้รัน `0047` แล้วรอคำสั่ง "push ได้เลย" หลัง deploy ทดสอบไฟล์ 20 MB จริงตาม spec หัวข้อ 6 และทดสอบ Review Focus ทั้ง 5 ข้อ
