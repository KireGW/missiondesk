import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { effectivePlan, type PlanId } from "@/lib/product/plans";

let pool: Pool | undefined;

export function getProductPool() {
  if (!pool) {
    const value = process.env.DATABASE_URL;
    if (!value) throw new Error("DATABASE_URL saknas.");
    const url = new URL(value);
    if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
    pool = new Pool({ connectionString: url.toString(), max: 2 });
  }
  return pool;
}

export interface PersonalAccount {
  id: string;
  status: "active" | "suspended";
  plan: PlanId;
  premiumUntil: string | null;
}

export async function findOrCreateAccount(subject: string): Promise<PersonalAccount> {
  const db = getProductPool();
  type AccountRow = { id: string; status: "active" | "suspended"; plan: PlanId; premium_until: Date | null };
  const existing = await db.query<AccountRow>(
    "SELECT id, status, plan, premium_until FROM product_accounts WHERE auth_subject = $1", [subject],
  );
  // Identity comes exclusively from the SDK-verified session, never email or request headers.
  const row = existing.rows[0] ?? (await db.query<AccountRow>(`
    INSERT INTO product_accounts (id, auth_subject) VALUES ($1, $2)
    ON CONFLICT (auth_subject) DO UPDATE SET auth_subject = EXCLUDED.auth_subject
    RETURNING id, status, plan, premium_until
  `, [randomUUID(), subject])).rows[0];
  return { id: row.id, status: row.status, plan: row.plan, premiumUntil: row.premium_until?.toISOString() ?? null };
}

export type UsageService = "llm" | "social";
export interface UsageRequest {
  accountId: string;
  operationKey: string;
  service: UsageService;
  reservedMicros: number;
  social?: { accounts: number; postsPerAccount: number };
}

export class UsageDenied extends Error {}

export async function reserveUsage(request: UsageRequest, db = getProductPool()) {
  if (!Number.isSafeInteger(request.reservedMicros) || request.reservedMicros <= 0 ||
      !request.operationKey.trim() || request.operationKey.length > 160 ||
      !["llm", "social"].includes(request.service)) throw new UsageDenied("Ogiltig reservation.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize reservations per account; concurrent HTTP requests and workers share this lock.
    const accountResult = await client.query<{
      plan: string; premium_until: Date | null; status: string;
      llm_monthly_budget_micros: string; social_monthly_budget_micros: string;
    }>("SELECT * FROM product_accounts WHERE id = $1 FOR UPDATE", [request.accountId]);
    const account = accountResult.rows[0];
    const now = new Date();
    const plan = effectivePlan({ plan: account?.plan ?? "free", premiumUntil: account?.premium_until?.toISOString() ?? null }, now.getTime());
    if (!account || account.status !== "active" || plan.id !== "premium") throw new UsageDenied("Premium krävs.");
    const existing = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM product_usage WHERE account_id = $1 AND operation_key = $2",
      [request.accountId, request.operationKey],
    );
    if (existing.rows.length) throw new UsageDenied("Operationen har redan reserverats.");
    const period = now.toISOString().slice(0, 7);
    const usage = await client.query<{ total: string }>(`
      SELECT COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_micros
        WHEN status = 'reserved' THEN reserved_micros ELSE 0 END), 0) AS total
      FROM product_usage WHERE account_id = $1 AND service = $2 AND period = $3
    `, [request.accountId, request.service, period]);
    const budget = request.service === "llm" ? account.llm_monthly_budget_micros : account.social_monthly_budget_micros;
    if (BigInt(usage.rows[0].total) + BigInt(request.reservedMicros) > BigInt(budget)) throw new UsageDenied("Månadsbudgeten är slut.");
    if (request.service === "social") {
      const units = request.social;
      if (!units || !Number.isInteger(units.accounts) || units.accounts < 1 || units.accounts > plan.social.accounts ||
          !Number.isInteger(units.postsPerAccount) || units.postsPerAccount < 1 || units.postsPerAccount > plan.social.postsPerAccount) {
        throw new UsageDenied("Sociala kvoten överskrids.");
      }
      const daily = await client.query<{ count: string }>(`
        SELECT COUNT(*) AS count FROM product_usage
        WHERE account_id = $1 AND service = 'social' AND status <> 'released'
          AND created_at >= $2::timestamptz AND created_at < $2::timestamptz + interval '1 day'
      `, [request.accountId, `${now.toISOString().slice(0, 10)}T00:00:00.000Z`]);
      if (Number(daily.rows[0].count) >= plan.social.runsPerDay) throw new UsageDenied("Dagens sociala körning är redan reserverad.");
    }
    const id = randomUUID();
    await client.query(`
      INSERT INTO product_usage (id, account_id, operation_key, service, period, reserved_micros, units)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `, [id, request.accountId, request.operationKey, request.service, period, request.reservedMicros, JSON.stringify(request.social ?? {})]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function settleUsage(accountId: string, id: string, actualMicros: number, db = getProductPool()) {
  if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) throw new UsageDenied("Ogiltig kostnad.");
  const result = await db.query(`
    UPDATE product_usage SET status = 'settled', actual_micros = $3, settled_at = now()
    WHERE account_id = $1 AND id = $2 AND status = 'reserved' RETURNING id
  `, [accountId, id, actualMicros]);
  // Record an overrun rather than hiding a real provider charge. It reduces the remaining budget.
  return result.rowCount === 1;
}

export async function releaseUnstartedUsage(accountId: string, id: string, db = getProductPool()) {
  const result = await db.query(`
    UPDATE product_usage SET status = 'released', settled_at = now()
    WHERE account_id = $1 AND id = $2 AND status = 'reserved' RETURNING id
  `, [accountId, id]);
  return result.rowCount === 1;
}

export async function inProductTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getProductPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
