import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { cache } from "react";
import { authConfigurationReady, getAccessMode, pilotInviteOnly } from "@/lib/product/config";
import { approvedUsernameSession, getUsernameLogin } from "@/lib/product/username-login";
import { getUsernameLoginApproval } from "@/lib/product/username-login-store";

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

export const getPersonalSessionIdentity = cache(async () => {
  const auth = getPersonalAuth();
  if (!auth) return null;
  const session = await auth.getSession();
  if (!session?.user.sub) return null;
  const subject = `${process.env.AUTH0_DOMAIN!.toLowerCase()}|${session.user.sub}`;
  const emailVerified = session.user.email_verified === true;
  const approval = session.user.sub.startsWith("auth0|") ? await getUsernameLoginApproval(subject) : null;
  const invitationRequired = pilotInviteOnly() && !approval;
  const accessVerified = approval
    ? approvedUsernameSession(approval, getUsernameLogin()?.connection, session.internal?.createdAt)
    : !invitationRequired && emailVerified;
  return { subject, emailVerified, managedUsername: Boolean(approval), displayName: approval?.displayName,
    interfaceProfile: approval?.interfaceProfile, accessVerified, invitationRequired };
});

export async function getPersonalIdentity() {
  const identity = await getPersonalSessionIdentity();
  return identity?.accessVerified ? { subject: identity.subject } : null;
}
