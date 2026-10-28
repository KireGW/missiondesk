import { getProductPool } from "@/lib/product/store";
import { defaultPersonalPreferences, parsePersonalPreferences, type PersonalPreferences } from "@/lib/product/profiles";

export async function getPersonalPreferences(accountId: string, db = getProductPool()): Promise<PersonalPreferences> {
  const result = await db.query(`SELECT home_country AS "homeCountry", target_country AS "targetCountry", language, content_language AS "contentLanguage"
    FROM product_account_preferences WHERE account_id = $1`, [accountId]);
  if (!result.rows.length) return { ...defaultPersonalPreferences };
  const preferences = parsePersonalPreferences(result.rows[0]);
  if (!preferences) throw new Error("Invalid stored personal profile.");
  return preferences;
}

export async function savePersonalPreferences(accountId: string, value: unknown, db = getProductPool()) {
  const preferences = parsePersonalPreferences(value);
  if (!preferences) return false;
  const result = await db.query(`INSERT INTO product_account_preferences (account_id, home_country, target_country, language, content_language)
    SELECT id, $2, $3, $4, $5 FROM product_accounts WHERE id = $1 AND status = 'active'
    ON CONFLICT (account_id) DO UPDATE SET home_country = EXCLUDED.home_country,
      target_country = EXCLUDED.target_country, language = EXCLUDED.language, content_language = EXCLUDED.content_language, updated_at = now()
    RETURNING account_id`, [accountId, preferences.homeCountry, preferences.targetCountry, preferences.language, preferences.contentLanguage]);
  return result.rowCount === 1;
}
