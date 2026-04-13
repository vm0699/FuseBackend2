import mongoose from "mongoose";

const ReportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
      index: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
      index: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["open", "reviewing", "resolved", "action_taken", "dismissed"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Report", ReportSchema);
