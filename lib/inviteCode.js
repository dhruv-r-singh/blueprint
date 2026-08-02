// Short, human-typeable invite codes (e.g. "K7QX2P9M") for joining a
// project via link, raw code, or QR. Not cryptographically unguessable —
// same trust model as the rest of this app's Firestore rules, which already
// let any signed-in user read any project.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid mixups

export function generateInviteCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export function inviteLink(code) {
  if (typeof window === "undefined") return `/join/${code}`;
  return `${window.location.origin}/join/${code}`;
}

export function qrCodeUrl(data, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}
