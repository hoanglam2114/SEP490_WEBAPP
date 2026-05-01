export type AuthSessionUser = {
  id?: string;
  _id?: string;
  userId?: string;
  name?: string;
  email?: string;
};

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

function safeParseUser(raw: string | null): AuthSessionUser | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSessionUser;
  } catch {
    return null;
  }
}

function migrateLegacyLocalStorageSession() {
  const sessionToken = sessionStorage.getItem(TOKEN_KEY);
  const sessionUser = sessionStorage.getItem(USER_KEY);
  if (sessionToken || sessionUser) {
    return;
  }

  const legacyToken = localStorage.getItem(TOKEN_KEY);
  const legacyUser = localStorage.getItem(USER_KEY);
  if (legacyToken) {
    sessionStorage.setItem(TOKEN_KEY, legacyToken);
  }
  if (legacyUser) {
    sessionStorage.setItem(USER_KEY, legacyUser);
  }
  if (legacyToken || legacyUser) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

export function getAuthToken(): string | null {
  migrateLegacyLocalStorageSession();
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getAuthUser(): AuthSessionUser | null {
  migrateLegacyLocalStorageSession();
  return safeParseUser(sessionStorage.getItem(USER_KEY));
}

export function getAuthUserId(): string {
  const user = getAuthUser();
  return String(user?.id || user?._id || user?.userId || '');
}

export function setAuthSession(user: AuthSessionUser, token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function clearAuthSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
