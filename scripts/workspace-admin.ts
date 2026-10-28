import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

export function personalAdmin() {
  const config = readPersonalTestEnvironment(process.cwd(), { requireAuth: false });
  const configDir = process.env.MISSIONDESK_NEON_CONFIG_DIR;
  const profile = process.env.MISSIONDESK_NEON_PROFILE;
  if (!configDir || !profile) throw new Error("An explicitly authenticated Neon profile is required");
  const project = config.values.MISSIONDESK_TEST_PROJECT_ID;
  const parentId = config.values.MISSIONDESK_TEST_BRANCH_ID;
  const app = new URL(config.values.DATABASE_URL);
  const ownerUrl = parseEnv(readFileSync(".env.local","utf8")).DATABASE_URL;
  if (!ownerUrl || !project) throw new Error("Verified personal database configuration required");
  const owner = decodeURIComponent(new URL(ownerUrl).username);
  function neon(args: string[]) {
    try {
      const output = execFileSync("npx",["--yes","neonctl@8.13.1","--config-dir",configDir!,...args,"--profile",profile!,"--output","json","--no-analytics"],
        {encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:120_000});
      try {return JSON.parse(output);} catch { if (/^postgres(?:ql)?:\/\//.test(output.trim())) return output.trim(); throw new Error(); }
    } catch {throw new Error("Neon operation failed; private credential output withheld");}
  }
  const response = neon(["branches","get",parentId,"--project-id",project]);
  const parent = response.branch ?? response;
  if (parent.id !== parentId || parent.default || parent.primary || !parent.parent_id || parent.name !== config.values.MISSIONDESK_TEST_BRANCH_NAME) {
    throw new Error("Refusing an unverified or primary branch");
  }
  function connect(branchId: string, roleName = owner) {
    if (![owner,"missiondesk_personal_app"].includes(roleName)) throw new Error("Unexpected database role");
    const response = neon(["connection-string",branchId,"--project-id",project,"--role-name",roleName,"--database-name","neondb","--pooled","--ssl","verify-full"]);
    const url = new URL(typeof response === "string" ? response : response.uri);
    const endpoints = neon(["api",`/projects/${project}/endpoints`]).endpoints;
    if (!endpoints.some((e:{branch_id:string;host:string}) => e.branch_id === branchId && e.host === url.hostname.replace(/-pooler(?=\.)/,""))) throw new Error("Wrong database endpoint");
    if (branchId === parentId && (url.hostname !== app.hostname || url.pathname !== app.pathname)) throw new Error("Wrong pilot database");
    if (url.hostname.replace(/-pooler(?=\.)/,"") === new URL(ownerUrl!).hostname.replace(/-pooler(?=\.)/,"")) throw new Error("Primary database is forbidden");
    return new Pool({connectionString:url.toString(),max:2});
  }
  return {config, project, parentId, neon, connect};
}
