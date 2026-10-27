import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { authConfigurationReady, getAccessMode } from "@/lib/product/config";

let client: Auth0Client | undefined;

export function getPersonalAuth() {
  if (getAccessMode() !== "personal" || !authConfigurationReady()) return null;
  client ??= new Auth0Client({
    appBaseUrl: process.env.APP_BASE_URL,
    authorizationParameters: { scope: "openid profile email" },
    session: { rolling: false, absoluteDuration: 60 * 60 * 12, cookie: { name: "missiondesk_session" } },
    enableAccessTokenEndpoint: false,
  });
  return client;
}

export async function getPersonalSessionIdentity() {
  const auth = getPersonalAuth();
  if (!auth) return null;
  const session = await auth.getSession();
  if (!session?.user.sub) return null;
  return { subject: `${process.env.AUTH0_DOMAIN!.toLowerCase()}|${session.user.sub}`, emailVerified: session.user.email_verified === true };
}

export async function getPersonalIdentity() {
  const identity = await getPersonalSessionIdentity();
  return identity?.emailVerified ? { subject: identity.subject } : null;
}
