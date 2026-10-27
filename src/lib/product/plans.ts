export type PlanId = "free" | "premium";

export interface ProductPlan {
  id: PlanId;
  label: string;
  feedLimit: number;
  archiveDays: number;
  social: { accounts: number; postsPerAccount: number; runsPerDay: number };
  onDemandAi: boolean;
}

export const productPlans: Readonly<Record<PlanId, ProductPlan>> = {
  free: {
    id: "free", label: "Gratis", feedLimit: 30, archiveDays: 7,
    social: { accounts: 0, postsPerAccount: 0, runsPerDay: 0 },
    onDemandAi: false,
  },
  premium: {
    id: "premium", label: "Premium", feedLimit: 100, archiveDays: 30,
    social: { accounts: 30, postsPerAccount: 20, runsPerDay: 1 },
    onDemandAi: true,
  },
};

export function effectivePlan(
  account: { plan: string; premiumUntil: string | null },
  now = Date.now(),
): ProductPlan {
  // Neither an expired grant nor an unknown plan may enable paid features.
  return account.plan === "premium" && Date.parse(account.premiumUntil ?? "") > now
    ? productPlans.premium
    : productPlans.free;
}

export interface PersonalDashboardAccess {
  plan: PlanId;
  label: string;
}
