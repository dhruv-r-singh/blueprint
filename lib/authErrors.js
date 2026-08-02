// Human-readable messages for the Firebase Auth error codes we actually hit,
// especially the ones that show up while a provider is mid-setup (LinkedIn
// OIDC in particular tends to fail with one of these during first setup).
export function describeAuthError(err, label = "Sign-in") {
  const code = err?.code || "";
  switch (code) {
    case "auth/operation-not-allowed":
      return `${label} failed — this sign-in method isn't turned on yet in the Firebase console (Authentication → Sign-in method).`;
    case "auth/unauthorized-domain":
      return `${label} failed — this domain isn't in Firebase's authorized domains list (Authentication → Settings → Authorized domains).`;
    case "auth/popup-closed-by-user":
      return `${label} cancelled — the popup was closed before finishing.`;
    case "auth/popup-blocked":
      return `${label} failed — the browser blocked the sign-in popup. Allow popups for this site and try again.`;
    case "auth/cancelled-popup-request":
      return ""; // a second popup was opened before the first resolved — not a real error, don't show it
    case "auth/account-exists-with-different-credential":
      return `${label} failed — an account already exists with this email using a different sign-in method.`;
    case "auth/invalid-credential":
      return `${label} failed — the identity provider rejected the request. If this is LinkedIn, double-check the OIDC client ID/secret and issuer URL in the Firebase console.`;
    case "auth/credential-already-in-use":
      return `That account is already linked to a different Blueprint user.`;
    case "auth/provider-already-linked":
      return `That provider is already connected.`;
    case "auth/network-request-failed":
      return `${label} failed — network error, check your connection and try again.`;
    default:
      return code ? `${label} failed — ${code}` : `${label} failed — try again.`;
  }
}
