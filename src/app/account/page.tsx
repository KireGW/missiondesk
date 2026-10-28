import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Library, LogIn, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { getAccessMode, authConfigurationReady, pilotInviteOnly } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { effectivePlan } from "@/lib/product/plans";
import { getPersonalSessionIdentity } from "@/lib/product/auth";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { defaultPersonalPreferences, interfaceLanguagesForProfile } from "@/lib/product/profiles";
import { personalMessages } from "@/lib/product/messages";
import { ProfileSettings } from "@/components/product/ProfileSettings";
import { getUsernameLogin } from "@/lib/product/username-login";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (getAccessMode() !== "personal") redirect("/");
  const ready = authConfigurationReady();
  const identity = ready ? await getPersonalSessionIdentity() : null;
  const unverified = identity && !identity.accessVerified;
  const invitationRequired = identity?.invitationRequired;
  const usernameLogin = ready ? getUsernameLogin() : null;
  const needsNewSession = unverified && identity.managedUsername;
  const account = ready ? await getPersonalAccount() : null;
  const plan = account ? effectivePlan(account) : null;
  const preferences = account ? await getPersonalPreferences(account.id)
    : pilotInviteOnly() ? { ...defaultPersonalPreferences, language: "en" as const } : defaultPersonalPreferences;
  const t = personalMessages(preferences.language);
  const interfaceLanguages = interfaceLanguagesForProfile(identity?.interfaceProfile);
  return (
    <main lang={preferences.language} className="missiondesk min-h-dvh px-4 py-8 text-[var(--app-fg)] sm:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-line)] pb-5">
          <h1 className="text-2xl font-semibold">MissionDesk</h1>
          {account?.status === "active" && <Link href="/" className="inline-flex items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />{t.back}</Link>}
        </header>
        <section className="py-8">
          <h2 className="text-xl font-semibold">{invitationRequired ? t.invitationRequired : needsNewSession ? t.signInAgain : unverified ? t.verify : account ? t.account : t.signIn}</h2>
          {identity?.displayName && <p className="mt-2 text-sm text-[var(--app-muted)]">{identity.displayName}</p>}
          {!ready ? <p className="mt-4">{t.unavailable}</p> : unverified ? (
            <>
              <p className="mt-4 text-sm leading-6">{invitationRequired ? t.invitationMessage : needsNewSession ? t.sessionExpired : t.verifyMessage}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a href={needsNewSession ? usernameLogin?.loginUrl ?? "/auth/login?prompt=login" : "/auth/login?prompt=login"} className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogIn className="h-4 w-4" />{t.signInAgain}</a>
                <a href="/auth/logout" className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogOut className="h-4 w-4" />{t.signOut}</a>
              </div>
            </>
          ) : !account ? (
            <a href="/auth/login" className="mt-5 inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogIn className="h-4 w-4" />{t.continueLogin}</a>
          ) : (
            <>
              {account.status === "active" && <ProfileSettings preferences={preferences} interfaceLanguages={interfaceLanguages} />}
              {account.status === "active" && <Link href={{ pathname: "/account/sources" }} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm text-[var(--app-accent)]"><Library className="h-4 w-4" />{t.sources}</Link>}
              <dl className="mt-6 divide-y divide-[var(--app-line)] text-sm">
                {account.status === "suspended" && <div className="py-3 text-[var(--app-warning)]">{t.suspended}</div>}
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>{t.subscription}</dt><dd>{plan!.id === "free" ? t.free : "Premium"}</dd></div>
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>{t.feed}</dt><dd>{plan!.feedLimit} {t.signals} · {plan!.archiveDays} {t.days}</dd></div>
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>{t.social}</dt><dd>{t.inactive}</dd></div>
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>{t.ai}</dt><dd>{t.inactive}</dd></div>
              </dl>
              <p className="mt-4 text-xs text-[var(--app-muted)]">{t.premiumLater}</p>
              <a href="/auth/logout" className="mt-6 inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-2"><LogOut className="h-4 w-4" />{t.signOut}</a>
            </>
          )}
          {usernameLogin && !identity?.managedUsername && <a href={usernameLogin.loginUrl} className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-[var(--app-accent)]"><UserRound className="h-4 w-4 shrink-0" />{t.usernameLogin}</a>}
          <p className="mt-8 flex items-center gap-2 text-sm text-[var(--app-muted)]"><ShieldCheck className="h-4 w-4 shrink-0" />{t.safety}</p>
        </section>
      </div>
    </main>
  );
}
