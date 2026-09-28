// Authentication for the erxes Content Hub GraphQL API.
//
// Primary mode: email + password through the NextAuth v4 credentials
// provider (GET /api/auth/csrf -> POST /api/auth/callback/credentials,
// session kept as cookies). Override mode: ERXES_SESSION_COOKIE supplies
// a ready-made Cookie header and skips the login flow entirely.
//
// Never log credentials or cookie values.

const BASE_URL = (process.env.ERXES_URL || "https://erxes.io").replace(
  /\/+$/,
  ""
);

const SESSION_COOKIE_PREFIXES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

// Minimal name -> value cookie jar for the login flow.
const jar = new Map<string, string>();

const captureCookies = (res: Response) => {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
};

const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

const sessionCookieNames = () =>
  [...jar.keys()].filter(
    name =>
      SESSION_COOKIE_PREFIXES.some(
        prefix => name === prefix || name.startsWith(`${prefix}.`)
      ) // session tokens may be chunked as .0, .1, ...
  );

const friendlyLoginError = (code: string | null): string => {
  if (code === "CredentialsSignin" || !code) {
    return "Invalid email or password (or the account is not allowed to sign in with credentials).";
  }
  return `Sign-in failed (${code}).`;
};

const login = async (): Promise<void> => {
  const email = process.env.ERXES_EMAIL;
  const password = process.env.ERXES_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Not authenticated. Set ERXES_EMAIL and ERXES_PASSWORD, " +
        "or ERXES_SESSION_COOKIE to reuse an existing session."
    );
  }

  jar.clear();

  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(
      `Could not reach ${BASE_URL}/api/auth/csrf (HTTP ${csrfRes.status}).`
    );
  }
  captureCookies(csrfRes);

  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) {
    throw new Error("Login failed: the CSRF endpoint returned no csrfToken.");
  }

  const body = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: BASE_URL,
    json: "true",
  });

  const callbackRes = await fetch(
    `${BASE_URL}/api/auth/callback/credentials`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(),
      },
      body,
    }
  );
  captureCookies(callbackRes);

  let payload: any = null;
  try {
    payload = await callbackRes.json();
  } catch {
    // Non-JSON body — the redirect target is checked below instead.
  }

  // With json=true, NextAuth answers {url}. Without it, the target is in
  // the Location header. Either way, a failed sign-in carries error=...
  const target =
    payload?.url || callbackRes.headers.get("location") || "";

  if (/[?&]error=/.test(target)) {
    throw new Error(
      friendlyLoginError(new URL(target, BASE_URL).searchParams.get("error"))
    );
  }

  if (sessionCookieNames().length === 0) {
    throw new Error(
      "Login failed: the credentials callback returned no session " +
        "cookie. Check ERXES_EMAIL and ERXES_PASSWORD."
    );
  }
};

let loggedIn = false;
let loginInFlight: Promise<void> | null = null;

/** True when ERXES_SESSION_COOKIE supplies the session directly. */
export const hasCookieOverride = (): boolean =>
  Boolean(process.env.ERXES_SESSION_COOKIE);

/**
 * Returns the Cookie header to send to the API. Logs in lazily on first
 * use when email/password auth is configured.
 */
export const getCookieHeader = async (): Promise<string> => {
  if (hasCookieOverride()) {
    return process.env.ERXES_SESSION_COOKIE!;
  }

  if (!loggedIn) {
    loginInFlight ??= login().then(() => {
      loggedIn = true;
    });
    try {
      await loginInFlight;
    } finally {
      loginInFlight = null;
    }
  }

  return cookieHeader();
};

/** Drops the cached session so the next request logs in again. */
export const resetSession = (): void => {
  loggedIn = false;
  jar.clear();
};

export const baseUrl = BASE_URL;
