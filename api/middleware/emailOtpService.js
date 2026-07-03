import crypto from "crypto";
import nodemailer from "nodemailer";
import EmailOtp from "../models/EmailOtp.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

const hashCode = (code) =>
  crypto.createHash("sha256").update(code).digest("hex");

const generateCode = () =>
  String(crypto.randomInt(100000, 1000000)); // 6 digits, no leading zero

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
 * Generates a 6-digit code, stores its hash (10 min expiry), and emails it.
 * Throws if SMTP is not configured — unlike ops alerts, this is user-facing
 * and must surface a clear error instead of silently no-op'ing.
 */
export const sendEmailOTP = async (email) => {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error(
      "Email sending is not configured on the server (missing SMTP_HOST/SMTP_USER/SMTP_PASS)."
    );
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Replace any existing pending code for this email
  await EmailOtp.deleteMany({ email });
  await EmailOtp.create({ email, codeHash, expiresAt });

  const from = process.env.OTP_EMAIL_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to: email,
    subject: "Your Fuse sign-in code",
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color:#ff5864;">Fuse</h2>
        <p>Your sign-in code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${code}</p>
        <p style="color:#6B7280; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};

/**
 * Verifies a submitted code against the stored hash.
 * Returns true/false. Deletes the OTP record on success or after
 * exceeding the attempt limit.
 */
export const verifyEmailOTP = async (email, code) => {
  const record = await EmailOtp.findOne({ email }).sort({ createdAt: -1 });

  if (!record) return false;

  if (record.expiresAt.getTime() < Date.now()) {
    await EmailOtp.deleteOne({ _id: record._id });
    return false;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await EmailOtp.deleteOne({ _id: record._id });
    return false;
  }

  const isMatch = record.codeHash === hashCode(String(code));

  if (!isMatch) {
    record.attempts += 1;
    await record.save();
    return false;
  }

  await EmailOtp.deleteOne({ _id: record._id });
  return true;
};

export default { sendEmailOTP, verifyEmailOTP };
