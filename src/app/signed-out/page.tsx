import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { BrandLogo } from "@/components/product/BrandLogo";
import { ProductFooter } from "@/components/product/ProductFooter";
import { getPersonalSessionIdentity } from "@/lib/product/auth";
import { getAccessMode } from "@/lib/product/config";
import { personalMessages } from "@/lib/product/messages";
import { getPilotLoginRedirect } from "@/lib/product/username-login";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Signed out | MissionDesk", robots: { index: false, follow: false } };

export default async function SignedOutPage() {
  if (getAccessMode() !== "personal") redirect("/");
  if (await getPersonalSessionIdentity()) redirect("/");
  const language = "en";
  const t = personalMessages(language);
  const login = getPilotLoginRedirect(false) ?? "/account";
  return <main lang={language} className="missiondesk flex min-h-dvh flex-col px-4 py-8 text-[var(--app-fg)] sm:px-8">
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      <header className="border-b border-[var(--app-line)] pb-5">
        <h1 className="text-2xl font-semibold"><Link href="/" prefetch={false} className="inline-flex rounded-sm hover:text-[var(--app-accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--app-accent)]"><BrandLogo /></Link></h1>
      </header>
      <section className="py-8">
        <h2 className="text-xl font-semibold">{t.signedOut}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--app-muted)]">{t.signedOutMessage}</p>
        <a href={login} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-3"><LogIn className="h-4 w-4" />{t.signIn}</a>
      </section>
      <ProductFooter language={language} />
    </div>
  </main>;
}
