import crypto from "crypto";

/**
 * Gift payment adapter.
 *
 * Provider-agnostic interface so the rest of the gift code never knows whether
 * it's talking to the dev placeholder or real Razorpay.
 *
 * Mode is driven by GIFT_PAYMENT_MODE:
 *   - "PLACEHOLDER" (default): no real money; dev/testing only.
 *   - "RAZORPAY": creates real provider orders + verifies signatures.
 *     (Stubbed until RAZORPAY_KEY_ID/SECRET + the native SDK are wired.)
 */
export const getGiftPaymentMode = () => {
  const mode = String(process.env.GIFT_PAYMENT_MODE || "PLACEHOLDER").toUpperCase();
  return mode === "RAZORPAY" ? "RAZORPAY" : "PLACEHOLDER";
};

/**
 * Create a provider payment/order for the given amount.
 * Returns: { mode, provider, providerOrderId, amount, currency, keyId? }
 */
export const createGiftPayment = async ({ amount, currency = "INR", intentId }) => {
  const mode = getGiftPaymentMode();

  if (mode === "RAZORPAY") {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error(
        "GIFT_PAYMENT_MODE=RAZORPAY but RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not set"
      );
    }
    // TODO: integrate the Razorpay SDK here once keys + native checkout exist.
    //   const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    //   const order = await rzp.orders.create({ amount: amount * 100, currency, receipt: String(intentId) });
    //   return { mode, provider: "RAZORPAY", providerOrderId: order.id, amount, currency, keyId };
    throw new Error("RAZORPAY provider not yet implemented");
  }

  // PLACEHOLDER: synthesize a deterministic-looking order id.
  return {
    mode: "PLACEHOLDER",
    provider: "PLACEHOLDER",
    providerOrderId: `ph_order_${intentId}_${Date.now()}`,
    amount,
    currency,
  };
};

/**
 * Verify a payment confirmation. Returns { verified: boolean, providerPaymentId }.
 *
 * PLACEHOLDER: trusts the call (dev only). RAZORPAY: verifies HMAC signature.
 */
export const verifyGiftPayment = async ({
  providerOrderId,
  providerPaymentId,
  signature,
}) => {
  const mode = getGiftPaymentMode();

  if (mode === "RAZORPAY") {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new Error("RAZORPAY_KEY_SECRET not set");
    }
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

  // PLACEHOLDER: accept, but synthesize a payment id if none provided.
  return {
    verified: true,
    providerPaymentId: providerPaymentId || `ph_pay_${Date.now()}`,
  };
};

export default {
  getGiftPaymentMode,
  createGiftPayment,
  verifyGiftPayment,
};
