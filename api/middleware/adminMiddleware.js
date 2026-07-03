/**
 * adminMiddleware — env-allowlist admin guard for gift operations.
 *
 * Must run AFTER authMiddleware (relies on req.user). An admin is any user
 * whose id is in ADMIN_USER_IDS or whose phoneNumber is in ADMIN_PHONE_NUMBERS
 * (comma-separated env vars). No frontend flag is trusted.
 */
const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const isAdminUser = (user) => {
  if (!user) return false;
  const adminIds = parseCsv(process.env.ADMIN_USER_IDS);
  const adminPhones = parseCsv(process.env.ADMIN_PHONE_NUMBERS);
  const idMatch = adminIds.includes(String(user.id));
  const phoneMatch =
    user.phoneNumber && adminPhones.includes(String(user.phoneNumber));
  return Boolean(idMatch || phoneMatch);
};

const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized" });
  }
  if (!isAdminUser(req.user)) {
    return res
      .status(403)
      .json({ success: false, message: "Admin access required" });
  }
  next();
};

export default adminMiddleware;
