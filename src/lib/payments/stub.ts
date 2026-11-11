import type { PaymentProvider } from "./provider";

export const PAYMENTS_UNAVAILABLE_TEXT =
  "ยังไม่เปิดให้ชำระเงิน ตอนนี้แลกวันใช้ Pro ด้วยฮูกคอยน์ได้ที่หน้าตั้งค่านะ";

/** Used until the Stripe keys are set (see src/lib/payments/index.ts). */
export const stubPaymentProvider: PaymentProvider = {
  name: "stub",
  available: false,
  async createCheckout() {
    return { status: "unavailable", message: PAYMENTS_UNAVAILABLE_TEXT };
  },
  async createAddonCheckout() {
    return { status: "unavailable", message: PAYMENTS_UNAVAILABLE_TEXT };
  },
  async changeSubscription() {
    return { status: "unavailable", message: PAYMENTS_UNAVAILABLE_TEXT };
  },
  async createPortal() {
    return { status: "unavailable", message: PAYMENTS_UNAVAILABLE_TEXT };
  },
  async listPayments() {
    return [];
  },
  async handleWebhook() {
    return { handled: false };
  },
};
