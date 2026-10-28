import { authConfigurationReady, getAccessMode } from "@/lib/product/config";
import type { InterfaceLanguageProfile } from "@/lib/product/profiles";

export function getUsernameLogin(env: Readonly<Record<string, string | undefined>> = process.env) {
  const connection = env.MISSIONDESK_USERNAME_CONNECTION ?? "";
  if (getAccessMode(env) !== "personal" || !authConfigurationReady(env) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,126}[a-zA-Z0-9]$/.test(connection)) return null;
  return {
    connection,
    loginUrl: `/auth/login?${new URLSearchParams({ connection, prompt: "login", max_age: "0", returnTo: "/" })}`,
  };
}

export interface UsernameLoginApproval {
  displayName: string;
  connection: string;
  enabled: boolean;
  accountActive: boolean;
  sessionsValidAfter: number;
  interfaceProfile: InterfaceLanguageProfile;
}

export function approvedUsernameSession(approval: UsernameLoginApproval, connection: string | undefined, createdAt: unknown) {
  return approval.enabled && approval.accountActive && approval.connection === connection &&
    typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt > 0 &&
    Number.isFinite(approval.sessionsValidAfter) && createdAt >= approval.sessionsValidAfter;
}
