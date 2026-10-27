import { cache } from "react";
import { getPersonalIdentity } from "@/lib/product/auth";
import { findOrCreateAccount } from "@/lib/product/store";

export const getPersonalAccount = cache(async () => {
  const identity = await getPersonalIdentity();
  if (!identity) return null;
  return findOrCreateAccount(identity.subject);
});
