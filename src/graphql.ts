import { getCookieHeader, hasCookieOverride, resetSession } from "./auth.js";
import { baseUrl } from "./auth.js";

// Matches the messages thrown by requireAuth/requireRole in
// erxes-global-profile lib/auth/utils/permissions.ts ("Unauthorized",
// "Forbidden", "Forbidden - ..."), plus generic auth wording.
const AUTH_ERROR_RE =
  /unauthori[sz]ed|forbidden|not authenticated|login required|invalid session/i;

const isAuthError = (status: number, errors: any[]): boolean =>
  status === 401 ||
  errors.some(e => AUTH_ERROR_RE.test(String(e?.message || "")));

export const graphqlRequest = async (
  query: string,
  variables: Record<string, unknown> = {},
  retried = false
): Promise<any> => {
  const cookie = await getCookieHeader();

  const res = await fetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ query, variables }),
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON response body.
  }

  const gqlErrors: any[] = payload?.errors || [];

  // On an auth failure with email/password auth, re-login once and retry
  // the request a single time. There is nothing to refresh when a fixed
  // session cookie was supplied.
  if (
    isAuthError(res.status, gqlErrors) &&
    !hasCookieOverride() &&
    !retried
  ) {
    resetSession();
    return graphqlRequest(query, variables, true);
  }

  if (gqlErrors.length) {
    const message = gqlErrors.map(e => e?.message || e).join("; ");
    if (isAuthError(res.status, gqlErrors) && /forbidden/i.test(message)) {
      throw new Error(
        `GraphQL error: ${message}. The account needs the cms, ams, ` +
          "admin or super_admin role to manage Content Hub items."
      );
    }
    throw new Error(`GraphQL error: ${message}`);
  }

  if (!res.ok) {
    throw new Error(
      `GraphQL request failed (${res.status}): ${
        payload?.error || res.statusText
      }`
    );
  }

  return payload?.data;
};
