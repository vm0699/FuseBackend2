import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const swipeRecordSchema = new Schema(
  {
    swiperId: { type: Schema.Types.ObjectId, ref: 'UserProfile', required: true },
    swipedId: { type: Schema.Types.ObjectId, ref: 'UserProfile', required: true },
    action: { type: String, enum: ['like', 'dislike'], required: true },
  },
  { timestamps: true }
);

// Fast lookup of all profiles a user has swiped
swipeRecordSchema.index({ swiperId: 1, swipedId: 1 }, { unique: true });
swipeRecordSchema.index({ swiperId: 1, createdAt: -1 });

export default model('SwipeRecord', swipeRecordSchema);
