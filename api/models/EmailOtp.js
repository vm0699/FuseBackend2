import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Short-lived OTP codes for the "log in with email" shortcut.
 * Codes are stored as a SHA-256 hash, never in plaintext.
 * The TTL index auto-deletes documents once expiresAt passes.
 */
const emailOtpSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model("EmailOtp", emailOtpSchema);
