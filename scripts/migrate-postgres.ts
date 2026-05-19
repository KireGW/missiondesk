import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { closeDb, runMigrations } = await import("../src/lib/db/postgres");

await runMigrations();
await closeDb();

console.log("MissionDesk Postgres migrations applied.");
