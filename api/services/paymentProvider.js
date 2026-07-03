/**
 * Generic payment provider for Fuse Explore verticals (bookings, events, premium).
 * Gift flow still uses giftPaymentProvider.js (untouched).
 *
 * Mode driven by PAYMENT_MODE env var:
 *   PLACEHOLDER (default) — no real money; dev/testing.
 *   RAZORPAY — creates real Razorpay orders + verifies HMAC signatures.
 */
import crypto from "crypto";
import Razorpay from "razorpay";

export const getPaymentMode = () => {
  const mode = String(process.env.PAYMENT_MODE || "PLACEHOLDER").toUpperCase();
  return mode === "RAZORPAY" ? "RAZORPAY" : "PLACEHOLDER";
};

const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "PAYMENT_MODE=RAZORPAY but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set"
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

/**
 * Create a provider order for the given amount (in INR paise for Razorpay).
 * @param {object} opts
 * @param {number} opts.amount - amount in INR (not paise; we convert internally)
 * @param {string} opts.currency - default "INR"
 * @param {string} opts.receipt  - unique receipt id (orderId / bookingId / etc.)
 * @param {string} opts.notes    - optional metadata object
 * @returns {{ mode, provider, providerOrderId, amount, currency, keyId? }}
 */
export const createPayment = async ({
  amount,
  currency = "INR",
  receipt,
  notes = {},
}) => {
  const mode = getPaymentMode();

  if (mode === "RAZORPAY") {
    const rzp = getRazorpayInstance();
    const order = await rzp.orders.create({
      amount: Math.round(amount * 100), // Razorpay uses paise
      currency,
      receipt: String(receipt),
      notes,
    });
    return {
      mode: "RAZORPAY",
      provider: "RAZORPAY",
      providerOrderId: order.id,
      amount,
      currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  return {
    mode: "PLACEHOLDER",
    provider: "PLACEHOLDER",
    providerOrderId: `ph_order_${receipt}_${Date.now()}`,
    amount,
    currency,
  };
};

/**
 * Verify a Razorpay payment signature. Returns { verified, providerPaymentId }.
 * In PLACEHOLDER mode always returns verified: true.
 */
export const verifyPayment = async ({
  providerOrderId,
  providerPaymentId,
  signature,
}) => {
  const mode = getPaymentMode();

  if (mode === "RAZORPAY") {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET not set");
    if (!providerOrderId || !providerPaymentId || !signature) {
      return { verified: false, providerPaymentId: providerPaymentId || null };
    }
    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest("hex");
    const verified =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    return { verified, providerPaymentId };
  }

  return {
    verified: true,
    providerPaymentId: providerPaymentId || `ph_pay_${Date.now()}`,
  };
};

export default { getPaymentMode, createPayment, verifyPayment };
