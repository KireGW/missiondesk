import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { getAccessMode, authConfigurationReady } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { effectivePlan } from "@/lib/product/plans";
import { getPersonalSessionIdentity } from "@/lib/product/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (getAccessMode() !== "personal") redirect("/");
  const ready = authConfigurationReady();
  const identity = ready ? await getPersonalSessionIdentity() : null;
  const unverified = identity && !identity.emailVerified;
  const account = ready ? await getPersonalAccount() : null;
  const plan = account ? effectivePlan(account) : null;
  return (
    <main className="missiondesk min-h-dvh px-4 py-8 text-[var(--app-fg)] sm:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-line)] pb-5">
          <h1 className="text-2xl font-semibold">MissionDesk</h1>
          {account?.status === "active" && <Link href="/" className="inline-flex items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />Till flödet</Link>}
        </header>
        <section className="py-8">
          <h2 className="text-xl font-semibold">{unverified ? "Verifiera din e-postadress" : account ? "Mitt konto" : "Logga in"}</h2>
          {!ready ? <p className="mt-4">Personlig inloggning är inte tillgänglig än.</p> : unverified ? (
            <>
              <p className="mt-4 text-sm leading-6">Bekräfta e-postadressen via meddelandet från inloggningstjänsten. Logga sedan in igen.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a href="/auth/login?prompt=login" className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogIn className="h-4 w-4" />Logga in igen</a>
                <a href="/auth/logout" className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogOut className="h-4 w-4" />Logga ut</a>
              </div>
            </>
          ) : !account ? (
            <a href="/auth/login" className="mt-5 inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogIn className="h-4 w-4" />Fortsätt till inloggning</a>
          ) : (
            <>
              <dl className="mt-6 divide-y divide-[var(--app-line)] text-sm">
                {account.status === "suspended" && <div className="py-3 text-[var(--app-warning)]">Kontot är pausat.</div>}
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>Abonnemang</dt><dd>{plan!.label}</dd></div>
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>Sociala medier</dt><dd>Inte aktiverat</dd></div>
                <div className="flex flex-wrap justify-between gap-3 py-3"><dt>AI på begäran</dt><dd>Inte aktiverat</dd></div>
              </dl>
              <a href="/auth/logout" className="mt-6 inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-2"><LogOut className="h-4 w-4" />Logga ut</a>
            </>
          )}
          <p className="mt-8 flex items-center gap-2 text-sm text-[var(--app-muted)]"><ShieldCheck className="h-4 w-4 shrink-0" />Endast öppna källor. Lägg inte in konfidentiella uppgifter.</p>
        </section>
      </div>
    </main>
  );
}
