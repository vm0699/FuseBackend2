// api/lib/ageValidation.js
//
// Server-side minimum-age enforcement (P0-2). Client-side checks (e.g.
// Intro.tsx) are cosmetic only — this is the actual gate that must hold
// regardless of what a modified client or direct API call sends.

const MIN_AGE = 18;

export function calculateAgeFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// Rejects missing/unparseable dates, future dates, and anyone under MIN_AGE.
export function isValidAdultDob(dob) {
  if (typeof dob !== "string" || !dob.trim()) return false;

  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return false;
  if (birth.getTime() > Date.now()) return false;

  const age = calculateAgeFromDob(dob);
  return typeof age === "number" && age >= MIN_AGE;
}

export default { calculateAgeFromDob, isValidAdultDob, MIN_AGE };
