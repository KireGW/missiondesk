import { tmpdir } from "node:os";
import path from "node:path";

export function isVercelRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export function missiondeskDataDir() {
  return (
    process.env.MISSIONDESK_DATA_DIR ??
    (isVercelRuntime()
      ? path.join(tmpdir(), "missiondesk")
      : path.join(process.cwd(), "data"))
  );
}
