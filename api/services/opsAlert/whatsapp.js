/**
 * Ops alert channel: Twilio WhatsApp.
 * Reuses existing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN from env.
 * Configure OPS_WHATSAPP_FROM and OPS_WHATSAPP_TO to activate.
 */
import twilio from "twilio";

const isConfigured = () =>
  !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.OPS_WHATSAPP_FROM &&
    process.env.OPS_WHATSAPP_TO
  );

/**
 * Send a structured ops alert via WhatsApp.
 * @param {string} message - plain-text message body
 */
export const sendWhatsAppAlert = async (message) => {
  if (!isConfigured()) {
    console.log("[OPS-WA] WhatsApp not configured — skipping. Set OPS_WHATSAPP_FROM / OPS_WHATSAPP_TO.");
    return;
  }
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const to = process.env.OPS_WHATSAPP_TO;
    const from = process.env.OPS_WHATSAPP_FROM;
    // Support comma-separated multiple recipients
    const recipients = to.split(",").map((s) => s.trim()).filter(Boolean);
    await Promise.all(
      recipients.map((recipient) =>
        client.messages.create({ from, to: recipient, body: message })
      )
    );
    console.log(`[OPS-WA] Alert sent to ${recipients.length} recipient(s).`);
  } catch (err) {
    console.error("[OPS-WA] Failed to send WhatsApp alert:", err.message);
  }
};

export default { sendWhatsAppAlert };
