export type AccessMode = "legacy" | "personal" | "invalid";

type Environment = Readonly<Record<string, string | undefined>>;

export function getAccessMode(env: Environment = process.env): AccessMode {
  const value = env.MISSIONDESK_ACCESS_MODE?.trim();
  if (!value || value === "legacy") return "legacy";
  return value === "personal" ? "personal" : "invalid";
}

export function authConfigurationReady(env: Environment = process.env) {
  if (!["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"]
    .every((key) => Boolean(env[key]?.trim()))) return false;
  if (!/^[a-f\d]{64}$/i.test(env.AUTH0_SECRET ?? "")) return false;
  try {
    const url = new URL(env.APP_BASE_URL!);
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"));
  } catch {
    return false;
  }
}
