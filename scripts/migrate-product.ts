import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

if (process.env.MISSIONDESK_ACCESS_MODE !== "personal" || !process.argv.includes("--apply")) {
  throw new Error("Product migration requires personal mode and --apply. Use a preview database, never the live engine by default.");
}

const { productSchemaSql } = await import("../src/lib/product/schema");
const { productPreferencesMigrationSql } = await import("../src/lib/product/preferences-migration");
const { productInterfaceLanguageMigrationSql } = await import("../src/lib/product/interface-language-migration");
const { getProductPool, inProductTransaction } = await import("../src/lib/product/store");

try {
  await inProductTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(713492, 1)");
    await client.query(productSchemaSql);
    await client.query(productPreferencesMigrationSql);
    await client.query(productInterfaceLanguageMigrationSql);
  });
  console.log("Product schema ready. Engine tables were not modified.");
} finally {
  await getProductPool().end();
}
