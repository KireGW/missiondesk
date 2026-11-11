"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BrainCircuit, History, Info, Newspaper, Radio, X } from "lucide-react";
import type { PersonalLanguage } from "@/lib/product/profiles";
import { personalMessages } from "@/lib/product/messages";
import { productPlans } from "@/lib/product/plans";

export function FreePlanDialog({ language }: { language: PersonalLanguage }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const t = personalMessages(language);
  const p = t.freePlan;
  const plan = productPlans.free;
  const limits = [
    { title: t.feed, description: p.feedLimit.replace("{limit}", String(plan.feedLimit)), icon: Newspaper },
    { title: p.history, description: p.archiveLimit.replace("{days}", String(plan.archiveDays)), icon: History },
    { title: t.social, description: p.socialLimit, icon: Radio },
    { title: t.ai, description: p.aiLimit, icon: BrainCircuit },
  ];

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(true)}
      className="mr-2 inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm px-0.5 text-xs text-[var(--app-muted)] underline-offset-4 hover:text-[var(--app-fg)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]">
      <span>{t.currentPlan}: <span className="text-[var(--app-positive)]">{t.free}</span></span>
      <Info aria-hidden="true" className="h-3 w-3" />
    </button>
    <dialog ref={dialog} id={id} lang={language} aria-labelledby={titleId} aria-describedby={descriptionId}
      onClose={() => setOpen(false)}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-[var(--app-line)] bg-[var(--app-panel-strong)] p-0 text-[var(--app-fg)] shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm">
      <div className="relative p-5 sm:p-7">
        <button type="button" aria-label={p.close} onClick={() => dialog.current?.close()}
          className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-[var(--app-panel)] hover:text-[var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] sm:right-5 sm:top-5">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <p className="pr-10 text-xs font-medium text-[var(--app-positive)]">{t.currentPlan}: {t.free}</p>
        <h2 id={titleId} className="mt-2 pr-10 text-xl font-semibold leading-7">{p.title}</h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-[var(--app-soft)]">{p.intro}</p>
        <ul className="mt-6 space-y-5">
          {limits.map(({ title, description, icon: Icon }) => <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] text-[var(--app-muted)]">
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{title}</p>
              <p className="mt-1 leading-6 text-[var(--app-soft)]">{description}</p>
            </div>
          </li>)}
        </ul>
      </div>
    </dialog>
  </>;
}
