/**
 * Ops alert channel: Email via nodemailer (SMTP / Gmail / SES).
 * Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * OPS_EMAIL_FROM, OPS_EMAIL_TO to activate.
 */
import nodemailer from "nodemailer";

let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    return null;
  }
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
};

/**
 * Send an ops alert email.
 * @param {string} subject
 * @param {string} htmlBody - full HTML body
 */
export const sendEmailAlert = async (subject, htmlBody) => {
  const transporter = getTransporter();
  if (!transporter) {
    console.log("[OPS-EMAIL] Email not configured — skipping. Set SMTP_HOST/USER/PASS.");
    return;
  }
  const from = process.env.OPS_EMAIL_FROM || process.env.SMTP_USER;
  const to = process.env.OPS_EMAIL_TO;
  if (!to) {
    console.log("[OPS-EMAIL] OPS_EMAIL_TO not set — skipping.");
    return;
  }
  try {
    await transporter.sendMail({ from, to, subject, html: htmlBody });
    console.log(`[OPS-EMAIL] Alert sent: ${subject}`);
  } catch (err) {
    console.error("[OPS-EMAIL] Failed to send email alert:", err.message);
  }
};

export default { sendEmailAlert };
