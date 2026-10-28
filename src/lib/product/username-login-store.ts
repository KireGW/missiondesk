import { getProductPool } from "@/lib/product/store";
import type { UsernameLoginApproval } from "@/lib/product/username-login";

// The application role can read approvals, but only the administrator can grant them.
export async function getUsernameLoginApproval(subject: string, db = getProductPool()): Promise<UsernameLoginApproval | null> {
  const result = await db.query(`SELECT p.display_name AS "displayName", p.connection_name AS connection,
      p.enabled, p.interface_profile AS "interfaceProfile", a.status = 'active' AS "accountActive",
      EXTRACT(EPOCH FROM p.sessions_valid_after)::double precision AS "sessionsValidAfter"
    FROM product_username_logins p JOIN product_accounts a ON a.id = p.account_id
    WHERE a.auth_subject = $1`, [subject]);
  return result.rows[0] ?? null;
}
