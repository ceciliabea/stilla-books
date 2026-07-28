export interface GoogleAuthorization {
  accessToken: string;
  expiresAt: number;
}

const GOOGLE_TOKEN_KEY = "stilla-google-token";
const EXPIRY_MARGIN_MS = 30_000;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadGoogleAuthorization(
  storage: SessionStore,
  now = Date.now(),
): GoogleAuthorization | null {
  try {
    const saved = storage.getItem(GOOGLE_TOKEN_KEY);
    if (!saved) return null;
    const authorization = JSON.parse(saved) as GoogleAuthorization;
    if (
      !authorization.accessToken ||
      !Number.isFinite(authorization.expiresAt) ||
      authorization.expiresAt <= now + EXPIRY_MARGIN_MS
    ) {
      storage.removeItem(GOOGLE_TOKEN_KEY);
      return null;
    }
    return authorization;
  } catch {
    storage.removeItem(GOOGLE_TOKEN_KEY);
    return null;
  }
}

export function storeGoogleAuthorization(
  storage: SessionStore,
  authorization: GoogleAuthorization,
) {
  storage.setItem(GOOGLE_TOKEN_KEY, JSON.stringify(authorization));
}

export function clearGoogleAuthorization(storage: SessionStore) {
  storage.removeItem(GOOGLE_TOKEN_KEY);
}
