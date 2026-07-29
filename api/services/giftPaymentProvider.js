import crypto from "crypto";
import Razorpay from "razorpay";

/**
 * Gift payment adapter.
 *
 * Provider-agnostic interface so the rest of the gift code never knows whether
 * it's talking to the dev placeholder, direct UPI, or real Razorpay.
 *
 * Mode is driven by GIFT_PAYMENT_MODE:
 *   - "UPI" (default): direct UPI deep link, no gateway. Verification is
 *     manual (admin reviews a user-submitted UTR) — see confirmGiftPayment.
 *   - "RAZORPAY": creates real provider orders + verifies signatures. Kept
 *     wired as a secondary/fallback path, reachable via an explicit
 *     preferredMode override even while UPI is the global default.
 *   - "PLACEHOLDER": no real money; dev/testing only.
 */
export const getGiftPaymentMode = () => {
  const mode = String(process.env.GIFT_PAYMENT_MODE || "UPI").toUpperCase();
  if (mode === "RAZORPAY" || mode === "UPI" || mode === "PLACEHOLDER") return mode;
  return "UPI";
};

const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "GIFT_PAYMENT_MODE=RAZORPAY but RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not set"
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

/**
 * Create a provider payment/order for the given amount.
 *
 * `amount` must always be the server-computed, frozen intent total (never a
 * client-supplied value) — every mode branch below only ever reads this
 * parameter, so that guarantee holds regardless of mode.
 *
 * `modeOverride` lets a caller force RAZORPAY for this one call (the
 * preferredMode fallback from initiateGiftPayment) without changing the
 * global GIFT_PAYMENT_MODE default.
 *
 * Returns: { mode, provider, providerOrderId, amount, currency, keyId?, upiDeepLink?, payeeVpa?, payeeName? }
 */
export const createGiftPayment = async ({ amount, currency = "INR", intentId, modeOverride }) => {
  const mode = modeOverride === "RAZORPAY" ? "RAZORPAY" : getGiftPaymentMode();

  if (mode === "UPI") {
    const payeeVpa = process.env.GIFT_UPI_VPA;
    const payeeName = process.env.GIFT_UPI_PAYEE_NAME || "Fuse";
    if (!payeeVpa) {
      throw new Error("GIFT_PAYMENT_MODE=UPI but GIFT_UPI_VPA is not set");
    }
    // txnRef doubles as tn/tr in the deep link and as providerOrderId, so an
    // admin eyeballing a bank statement narration has something to match.
    // NPCI's UPI deep-link spec requires `tr` to be alphanumeric only (no
    // underscores/hyphens) — a non-conforming `tr` can be rejected by the
    // beneficiary bank's UPI switch, which GPay then surfaces as a vague
    // "recipient's server is down" instead of a real error.
    const txnRef = `gift${intentId}`;
    const deepLink =
      `upi://pay?pa=${encodeURIComponent(payeeVpa)}` +
      `&pn=${encodeURIComponent(payeeName)}` +
      `&am=${encodeURIComponent(Number(amount).toFixed(2))}` +
      `&cu=${encodeURIComponent(currency)}` +
      `&tn=${encodeURIComponent(`Fuse Gift ${txnRef}`)}` +
      `&tr=${encodeURIComponent(txnRef)}`;
    return {
      mode: "UPI",
      provider: "UPI",
      providerOrderId: txnRef,
      amount,
      currency,
      upiDeepLink: deepLink,
      payeeVpa,
      payeeName,
    };
  }

  if (mode === "RAZORPAY") {
    const rzp = getRazorpayInstance();
    const order = await rzp.orders.create({
      amount: Math.round(amount * 100), // Razorpay uses paise
      currency,
      receipt: String(intentId),
      notes: { intentId: String(intentId), source: "FUSE_GIFT" },
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
 * UPI: there is no signature/webhook to check for a direct peer transfer, so
 * this always fails closed (verified:false). confirmGiftPayment must branch
 * around this function entirely for UPI mode and route through manual admin
 * verification instead — this fallback exists only so a future bug that
 * forgets to branch doesn't accidentally auto-approve like PLACEHOLDER does.
 */
export const verifyGiftPayment = async ({
  providerOrderId,
  providerPaymentId,
  signature,
}) => {
  const mode = getGiftPaymentMode();

  if (mode === "UPI") {
    return {
      verified: false,
      providerPaymentId: providerPaymentId || null,
      requiresManualVerification: true,
    };
  }

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
