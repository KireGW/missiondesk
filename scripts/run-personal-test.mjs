import { spawn } from "node:child_process";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

const command = process.argv[2] ?? "check";
if (!["check", "dev", "migrate", "smoke"].includes(command)) throw new Error("Use check, dev, migrate or smoke.");
const config = readPersonalTestEnvironment(process.cwd(), { requireAuth: ["check", "dev"].includes(command) });
if (command === "check") {
  console.log("Personal preview configured on localhost:3001; database endpoint is separate; paid provider keys are disabled.");
} else {
  const tsOptions = ["--experimental-strip-types", "--experimental-loader", "./scripts/node-ts-loader.mjs"];
  const args = command === "dev" ? ["node_modules/next/dist/bin/next", "dev", "--port", String(config.port)]
    : command === "migrate" ? [...tsOptions, "scripts/migrate-personal.ts"]
      : ["--experimental-test-module-mocks", ...tsOptions, "scripts/smoke-product-postgres.ts", "--apply"];
  const child = spawn(process.execPath, args, { env: config.env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => { console.error("The personal preview command could not start."); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
