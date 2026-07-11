/**
 * Event Circle controller — Explore Iteration 2.
 * Handles RSVP lifecycle, the attendee circle (teaser/grid), waves, and check-in
 * for MEET_PEOPLE events. Gift flow and the existing Razorpay ticket flow are untouched.
 */
import mongoose from "mongoose";
import Event from "../models/Event.js";
import EventRsvp from "../models/EventRsvp.js";
import EventWave from "../models/EventWave.js";
import UserProfile from "../models/UserProfile.js";
import Block from "../models/Block.js";
import SwipeRecord from "../models/SwipeRecord.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { logEvent } from "../services/analytics/logEvent.js";
import { hasBlockBetweenUsers, hasSafetyHoldBetweenUsers } from "../services/giftEligibilityService.js";
import { establishMatch } from "../services/matchService.js";
import { alertEventCapacity } from "../services/opsAlertService.js";

const MAX_WAVES_PER_EVENT = 3;

function calculateAge(dob) {
  if (!dob) return null;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

async function getBlockedIdSet(userId) {
  const blocks = await Block.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  })
    .select("blockerId blockedId")
    .lean();
  const set = new Set();
  for (const b of blocks) {
    const other =
      b.blockerId?.toString() === userId.toString() ? b.blockedId?.toString() : b.blockerId?.toString();
    if (other) set.add(other);
  }
  return set;
}

const ACTIVE_RSVP_STATUSES = ["GOING", "CHECKED_IN"];
const MAX_ACTIVE_RSVPS = 5;
const MAX_DAILY_RSVPS = 3;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// ─── RSVP ───────────────────────────────────────────────────────────────────

export const createRsvp = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    const showMeInCircle = req.body?.showMeInCircle !== false;

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event id." });
    }

    const event = await Event.findOne({ _id: eventId, isActive: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    if (!event.eventDate || event.eventDate < new Date()) {
      return res.status(400).json({ success: false, message: "Event has already passed." });
    }
    if (!["FREE_RSVP", "PAID_EXTERNAL"].includes(event.pricingType)) {
      return res.status(400).json({
        success: false,
        message: "This event requires a ticket purchase, not an RSVP.",
      });
    }

    const existing = await EventRsvp.findOne({ userId, eventId });
    if (existing && ACTIVE_RSVP_STATUSES.includes(existing.status)) {
      // Already RSVP'd — idempotent success, no rate-limit/cap re-check.
      return res.json({
        success: true,
        rsvp: { status: existing.status, showMeInCircle: existing.showMeInCircle },
        promoCode: event.pricingType === "PAID_EXTERNAL" ? event.promoCode : undefined,
      });
    }

    const [activeCount, dailyCount] = await Promise.all([
      EventRsvp.countDocuments({
        userId,
        status: { $in: ACTIVE_RSVP_STATUSES },
        "eventSnapshot.eventDate": { $gte: new Date() },
      }),
      EventRsvp.countDocuments({ userId, createdAt: { $gte: startOfToday() } }),
    ]);

    if (activeCount >= MAX_ACTIVE_RSVPS) {
      return res.status(400).json({
        success: false,
        reason: "RSVP_ACTIVE_LIMIT",
        message: "You already have the maximum number of upcoming RSVPs.",
      });
    }
    if (dailyCount >= MAX_DAILY_RSVPS) {
      return res.status(400).json({
        success: false,
        reason: "RSVP_DAILY_LIMIT",
        message: "You've hit today's RSVP limit. Try again tomorrow.",
      });
    }

    if (event.rsvpCap != null && (event.rsvpCount || 0) >= event.rsvpCap) {
      return res.status(400).json({ success: false, reason: "EVENT_FULL", message: "This event is full." });
    }

    const rsvp = await EventRsvp.findOneAndUpdate(
      { userId, eventId },
      {
        $set: {
          status: "GOING",
          source: "RSVP",
          showMeInCircle,
          cancelledAt: null,
          eventSnapshot: {
            title: event.title,
            eventDate: event.eventDate,
            eventEndDate: event.eventEndDate,
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Only grow the counter for a genuinely new/reactivated GOING row.
    const wasNewMember = !existing || existing.status === "CANCELLED";
    if (wasNewMember) {
      const oldCount = event.rsvpCount || 0;
      const newCount = oldCount + 1;
      await Event.findByIdAndUpdate(eventId, { $inc: { rsvpCount: 1 } });

      // Fire the capacity alert once, on the RSVP that crosses the 80% threshold.
      if (event.rsvpCap != null) {
        const threshold = event.rsvpCap * 0.8;
        if (newCount >= threshold && oldCount < threshold) {
          alertEventCapacity({ ...event, rsvpCount: newCount }).catch(() => {});
        }
      }
    }

    const promoCode = event.pricingType === "PAID_EXTERNAL" ? event.promoCode : undefined;
    logEvent("event_rsvp_created", userId, { eventId: event._id.toString() });
    if (promoCode) logEvent("event_promo_revealed", userId, { eventId: event._id.toString() });

    notificationService
      .sendToUser(
        userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.EVENT_RSVP_CONFIRMED,
          body: `You're going to "${event.title}"!`,
          data: { eventId: event._id.toString() },
        })
      )
      .catch(() => {});

    res.json({
      success: true,
      rsvp: { status: rsvp.status, showMeInCircle: rsvp.showMeInCircle },
      promoCode,
    });
  } catch (err) {
    console.error("[EventCircleController] createRsvp:", err);
    res.status(500).json({ success: false, message: "Could not RSVP to this event." });
  }
};

export const cancelRsvp = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;

    const rsvp = await EventRsvp.findOne({ userId, eventId });
    if (!rsvp || !ACTIVE_RSVP_STATUSES.includes(rsvp.status)) {
      return res.json({ success: true });
    }

    rsvp.status = "CANCELLED";
    rsvp.cancelledAt = new Date();
    await rsvp.save();

    await Event.findByIdAndUpdate(eventId, { $inc: { rsvpCount: -1 } });

    logEvent("event_rsvp_cancelled", userId, { eventId });

    res.json({ success: true });
  } catch (err) {
    console.error("[EventCircleController] cancelRsvp:", err);
    res.status(500).json({ success: false, message: "Could not cancel RSVP." });
  }
};

export const updateRsvpVisibility = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    const showMeInCircle = Boolean(req.body?.showMeInCircle);

    const rsvp = await EventRsvp.findOneAndUpdate(
      { userId, eventId },
      { $set: { showMeInCircle } },
      { new: true }
    );
    if (!rsvp) return res.status(404).json({ success: false, message: "RSVP not found." });

    res.json({ success: true, rsvp: { status: rsvp.status, showMeInCircle: rsvp.showMeInCircle } });
  } catch (err) {
    console.error("[EventCircleController] updateRsvpVisibility:", err);
    res.status(500).json({ success: false, message: "Could not update visibility." });
  }
};

export const getMyEvents = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rsvps, me] = await Promise.all([
      EventRsvp.find({ userId, status: { $in: ACTIVE_RSVP_STATUSES } })
        .sort({ "eventSnapshot.eventDate": 1 })
        .lean(),
      UserProfile.findById(userId).select("eventStats").lean(),
    ]);

    const now = new Date();
    const upcoming = [];
    const past = [];
    for (const r of rsvps) {
      (r.eventSnapshot?.eventDate && new Date(r.eventSnapshot.eventDate) >= now ? upcoming : past).push(
        serializeRsvp(r)
      );
    }

    res.json({
      success: true,
      upcoming,
      past,
      eventStats: {
        checkInCount: me?.eventStats?.checkInCount || 0,
        currentStreak: me?.eventStats?.currentStreak || 0,
        badges: me?.eventStats?.badges || [],
      },
    });
  } catch (err) {
    console.error("[EventCircleController] getMyEvents:", err);
    res.status(500).json({ success: false, message: "Could not load your events." });
  }
};

// ─── Check-in ───────────────────────────────────────────────────────────────

const STREAK_RECENCY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REGULAR_BADGE_THRESHOLD = 3;

export const checkin = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    const code = String(req.body?.code || "").trim();

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event id." });
    }
    if (!code) {
      return res.status(400).json({ success: false, message: "Check-in code required." });
    }

    const [rsvp, event] = await Promise.all([
      EventRsvp.findOne({ userId, eventId }),
      Event.findById(eventId).lean(),
    ]);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    if (!rsvp || !ACTIVE_RSVP_STATUSES.includes(rsvp.status)) {
      return res.status(400).json({ success: false, message: "RSVP to this event first." });
    }
    if (rsvp.status === "CHECKED_IN") {
      return res.json({ success: true, alreadyCheckedIn: true });
    }
    if (!event.checkInCode || code.toUpperCase() !== String(event.checkInCode).toUpperCase()) {
      return res.status(400).json({ success: false, reason: "INVALID_CODE", message: "That code doesn't match." });
    }

    const now = new Date();
    const opensAt = event.checkInOpensAt || new Date(new Date(event.eventDate).getTime() - 2 * 60 * 60 * 1000);
    const closesAt =
      event.checkInClosesAt ||
      new Date(new Date(event.eventEndDate || new Date(event.eventDate).getTime() + 4 * 60 * 60 * 1000).getTime() + 2 * 60 * 60 * 1000);
    if (now < opensAt || now > closesAt) {
      return res.status(400).json({ success: false, reason: "OUTSIDE_WINDOW", message: "Check-in isn't open for this event right now." });
    }

    rsvp.status = "CHECKED_IN";
    rsvp.checkedInAt = now;
    await rsvp.save();

    const me = await UserProfile.findById(userId).select("eventStats").lean();
    const lastCheckInAt = me?.eventStats?.lastCheckInAt ? new Date(me.eventStats.lastCheckInAt) : null;
    const withinStreakWindow = lastCheckInAt && now.getTime() - lastCheckInAt.getTime() <= STREAK_RECENCY_MS;
    const newCheckInCount = (me?.eventStats?.checkInCount || 0) + 1;
    const newStreak = withinStreakWindow ? (me?.eventStats?.currentStreak || 0) + 1 : 1;
    const alreadyHasBadge = (me?.eventStats?.badges || []).includes("FUSE_REGULAR");
    const justEarnedBadge = !alreadyHasBadge && newCheckInCount >= REGULAR_BADGE_THRESHOLD;

    await UserProfile.updateOne(
      { _id: userId },
      {
        $set: {
          "eventStats.checkInCount": newCheckInCount,
          "eventStats.currentStreak": newStreak,
          "eventStats.lastCheckInAt": now,
        },
        ...(justEarnedBadge ? { $addToSet: { "eventStats.badges": "FUSE_REGULAR" } } : {}),
      }
    );

    logEvent("event_checked_in", userId, { eventId, checkInCount: newCheckInCount });

    if (justEarnedBadge) {
      logEvent("event_badge_earned", userId, { eventId, badge: "FUSE_REGULAR" });
      notificationService
        .sendToUser(
          userId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.EVENT_BADGE_EARNED,
            body: "You've checked into 3 Fuse events — you're a Fuse Regular!",
            data: {},
          })
        )
        .catch(() => {});
    }

    res.json({ success: true, badgeEarned: justEarnedBadge ? "FUSE_REGULAR" : undefined });
  } catch (err) {
    console.error("[EventCircleController] checkin:", err);
    res.status(500).json({ success: false, message: "Could not check in." });
  }
};

// ─── Circle (teaser / attendee grid) ───────────────────────────────────────

export const getCircle = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event id." });
    }

    const [myRsvp, me] = await Promise.all([
      EventRsvp.findOne({ userId, eventId }).lean(),
      UserProfile.findById(userId).select("interests").lean(),
    ]);
    const myInterests = new Set(me?.interests || []);
    const hasAccess = myRsvp && ACTIVE_RSVP_STATUSES.includes(myRsvp.status);

    const activeRsvps = await EventRsvp.find({
      eventId,
      status: { $in: ACTIVE_RSVP_STATUSES },
      userId: { $ne: userId },
    })
      .select("userId showMeInCircle")
      .lean();

    if (!hasAccess) {
      // Teaser only — aggregate stats, no identities.
      const visibleIds = activeRsvps.map((r) => r.userId);
      const profiles = await UserProfile.find({ _id: { $in: visibleIds } })
        .select("gender interests")
        .lean();

      const genderBalance = { men: 0, women: 0, other: 0 };
      let sharedInterestCount = 0;
      for (const p of profiles) {
        if (p.gender === "Man") genderBalance.men += 1;
        else if (p.gender === "Woman") genderBalance.women += 1;
        else genderBalance.other += 1;
        if ((p.interests || []).some((i) => myInterests.has(i))) sharedInterestCount += 1;
      }

      logEvent("event_circle_viewed", userId, { eventId, hasAccess: false });

      return res.json({
        success: true,
        hasAccess: false,
        teaser: {
          goingCount: activeRsvps.length,
          genderBalance,
          sharedInterestCount,
        },
      });
    }

    // Full grid — respects showMeInCircle and blocked pairs.
    const blockedIds = await getBlockedIdSet(userId);
    const visibleRsvps = activeRsvps.filter(
      (r) => r.showMeInCircle && !blockedIds.has(r.userId.toString())
    );
    const visibleIds = visibleRsvps.map((r) => r.userId);

    const [profiles, myWaves] = await Promise.all([
      UserProfile.find({ _id: { $in: visibleIds } })
        .select("name dateOfBirth photos interests")
        .lean(),
      EventWave.find({ eventId, fromUserId: userId }).select("toUserId status").lean(),
    ]);

    const waveByUserId = new Map(myWaves.map((w) => [w.toUserId.toString(), w.status]));

    const attendees = profiles.map((p) => {
      const sharedInterestCount = (p.interests || []).filter((i) => myInterests.has(i)).length;
      const waveStatus = waveByUserId.get(p._id.toString());
      return {
        userId: p._id,
        name: p.name,
        age: calculateAge(p.dateOfBirth),
        photo: p.photos?.[0] || null,
        sharedInterestCount,
        waveStatus: waveStatus === "MATCHED" ? "MATCHED" : waveStatus === "PENDING" ? "PENDING" : "NONE",
      };
    });

    logEvent("event_circle_viewed", userId, { eventId, hasAccess: true, attendeeCount: attendees.length });

    res.json({ success: true, hasAccess: true, attendees });
  } catch (err) {
    console.error("[EventCircleController] getCircle:", err);
    res.status(500).json({ success: false, message: "Could not load the event circle." });
  }
};

// ─── Wave ───────────────────────────────────────────────────────────────────

export const wave = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    const { toUserId } = req.body || {};

    if (!mongoose.isValidObjectId(eventId) || !mongoose.isValidObjectId(toUserId)) {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }
    if (toUserId === userId) {
      return res.status(400).json({ success: false, message: "You can't wave at yourself." });
    }

    const [myRsvp, theirRsvp] = await Promise.all([
      EventRsvp.findOne({ userId, eventId }).lean(),
      EventRsvp.findOne({ userId: toUserId, eventId }).lean(),
    ]);
    if (!myRsvp || !ACTIVE_RSVP_STATUSES.includes(myRsvp.status)) {
      return res.status(400).json({ success: false, message: "RSVP to this event first." });
    }
    if (!theirRsvp || !ACTIVE_RSVP_STATUSES.includes(theirRsvp.status) || !theirRsvp.showMeInCircle) {
      return res.status(404).json({ success: false, message: "That attendee isn't available." });
    }

    const [blocked, safetyHold] = await Promise.all([
      hasBlockBetweenUsers(userId, toUserId),
      hasSafetyHoldBetweenUsers(userId, toUserId),
    ]);
    if (blocked || safetyHold) {
      return res.status(403).json({ success: false, message: "You can't wave at this user." });
    }

    let myWave = await EventWave.findOne({ eventId, fromUserId: userId, toUserId });
    if (!myWave) {
      const waveCount = await EventWave.countDocuments({ eventId, fromUserId: userId });
      if (waveCount >= MAX_WAVES_PER_EVENT) {
        return res.status(400).json({
          success: false,
          reason: "WAVE_LIMIT_REACHED",
          message: "You've used all your waves for this event.",
        });
      }
      myWave = await EventWave.create({ eventId, fromUserId: userId, toUserId, status: "PENDING" });
    } else if (myWave.status === "MATCHED") {
      return res.json({ success: true, isMatch: true });
    }

    const reciprocal = await EventWave.findOne({
      eventId,
      fromUserId: toUserId,
      toUserId: userId,
      status: "PENDING",
    });

    logEvent("event_wave_sent", userId, { eventId, toUserId });

    if (!reciprocal) {
      notificationService
        .sendToUser(
          toUserId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.EVENT_WAVE_RECEIVED,
            body: "Someone from your event circle waved at you.",
            data: { eventId },
          })
        )
        .catch(() => {});
      return res.json({ success: true, isMatch: false });
    }

    // Mutual wave — establish the match through the shared match service.
    await Promise.all([
      EventWave.updateOne({ _id: myWave._id }, { $set: { status: "MATCHED" } }),
      EventWave.updateOne({ _id: reciprocal._id }, { $set: { status: "MATCHED" } }),
      SwipeRecord.findOneAndUpdate(
        { swiperId: userId, swipedId: toUserId },
        { $set: { action: "like" } },
        { upsert: true }
      ),
      SwipeRecord.findOneAndUpdate(
        { swiperId: toUserId, swipedId: userId },
        { $set: { action: "like" } },
        { upsert: true }
      ),
    ]);

    const otherUserProfile = await UserProfile.findById(toUserId).select("_id name photos").lean();
    const matchResult = await establishMatch({
      userAId: userId,
      userBId: toUserId,
      otherUserProfile,
      source: "event_wave",
      eventId,
    });

    logEvent("event_wave_matched", userId, { eventId, toUserId, chatId: matchResult.chatId?.toString() });

    const me = await UserProfile.findById(userId).select("_id name photos").lean();
    notificationService
      .sendToUser(
        toUserId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.EVENT_WAVE_MATCHED,
          body: `You and ${me?.name || "someone"} matched!`,
          data: {
            chatId: matchResult.chatId?.toString(),
            counterpartId: userId,
            extra: { counterpartName: me?.name },
          },
        })
      )
      .catch(() => {});

    res.json({
      success: true,
      isMatch: true,
      chatId: matchResult.chatId,
      otherUser: matchResult.otherUser,
    });
  } catch (err) {
    console.error("[EventCircleController] wave:", err);
    res.status(500).json({ success: false, message: "Could not send wave." });
  }
};

// ─── Serializers ────────────────────────────────────────────────────────────

const serializeRsvp = (r) => ({
  _id: r._id,
  eventId: r.eventId,
  status: r.status,
  showMeInCircle: r.showMeInCircle,
  eventSnapshot: r.eventSnapshot,
  checkedInAt: r.checkedInAt,
  createdAt: r.createdAt,
});

export default {
  createRsvp,
  cancelRsvp,
  updateRsvpVisibility,
  getMyEvents,
  checkin,
  getCircle,
  wave,
};
