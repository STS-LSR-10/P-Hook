import { describe, expect, it } from "vitest";
import { looksSecret } from "./secret-text";

describe("looksSecret", () => {
  it.each([
    "รหัสไวไฟ 12345678",
    "password: abc",
    "PIN 1234",
    "otp 998877",
    "1234567890123",
    "1-2345-67890-12-3",
    "4111 1111 1111 1111",
    "๑๒๓๔๕๖๗๘๙๐๑๒๓",
  ])("flags %s", (t) => expect(looksSecret(t)).toBe(true));

  it.each([
    "กาแฟ 50",
    "น้ำมัน 500",
    "เตือนกินยา 6 โมงเย็น",
    "0812345678",
    "ไปเที่ยวต้องซื้อหมวก",
    "shopping list",
    "12345678901234",
  ])("leaves %s", (t) => expect(looksSecret(t)).toBe(false));
});
