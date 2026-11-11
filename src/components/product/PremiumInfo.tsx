import Link from "next/link";
import { BrainCircuit, Files, History, Languages, ListFilter, MessagesSquare, Radio } from "lucide-react";
import type { PersonalLanguage } from "@/lib/product/profiles";
import { personalMessages } from "@/lib/product/messages";

export function PremiumInfo({ language, titleId, headingLevel = "h2" }: {
  language: PersonalLanguage;
  titleId?: string;
  headingLevel?: "h2" | "h3";
}) {
  const t = personalMessages(language);
  const p = t.premium;
  const Heading = headingLevel;
  const features = [
    { key: "overview", icon: Languages },
    { key: "history", icon: History },
    { key: "analysis", icon: BrainCircuit },
    { key: "social", icon: Radio },
    { key: "briefings", icon: Files },
    { key: "focus", icon: ListFilter },
    { key: "support", icon: MessagesSquare },
  ] as const;

  return <>
    <p className="pr-10 text-xs font-medium text-[var(--app-gold)]">{p.eyebrow}</p>
    <Heading id={titleId} className="mt-2 text-xl font-semibold leading-7 text-[var(--app-fg)]">{p.title}</Heading>
    <p className="mt-3 text-sm leading-6 text-[var(--app-soft)]">{p.intro}</p>
    <ul className="mt-6 space-y-5">
      {features.map(({ key, icon: Icon }) => <li key={key} className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] text-[var(--app-gold)]">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-[var(--app-fg)]">{p.features[key].title}</p>
          <p className="mt-1 leading-6 text-[var(--app-soft)]">{p.features[key].description}</p>
          {key === "social" && <p className="mt-2 leading-6 text-[var(--app-soft)]">
            {p.socialSourcesIntro}{" "}
            <Link href={{ pathname: "/account/sources", query: { lang: language }, hash: "source-group-social" }} prefetch={false}
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]">
              <span className="text-[var(--app-accent)] underline underline-offset-4 hover:text-[var(--app-accent-strong)]">{p.socialSourcesLink}</span>
            </Link>.
          </p>}
        </div>
      </li>)}
    </ul>
    <div className="mt-6 border-t border-[var(--app-line)] pt-4 text-xs leading-5 text-[var(--app-muted)]">
      <p>{p.status}</p>
    </div>
  </>;
}
