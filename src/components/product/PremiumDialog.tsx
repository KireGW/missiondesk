"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import type { PersonalLanguage } from "@/lib/product/profiles";
import { personalMessages } from "@/lib/product/messages";
import { PremiumInfo } from "@/components/product/PremiumInfo";

export function PremiumDialog({ language }: { language: PersonalLanguage }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const p = personalMessages(language).premium;

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
    <button type="button" aria-label={p.discover} title={p.discover} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(true)}
      className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-sm px-0.5 text-xs font-normal text-[var(--app-gold)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-gold)]">
      <span className="text-xs font-normal">{p.discover}</span><Info aria-hidden="true" className="h-3 w-3" />
    </button>
    <dialog ref={dialog} id={id} lang={language} aria-labelledby={titleId} onClose={() => setOpen(false)}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-[var(--app-line)] bg-[var(--app-panel-strong)] p-0 text-[var(--app-fg)] shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm">
      <div className="relative p-5 sm:p-7">
        <button type="button" aria-label={p.close} onClick={() => dialog.current?.close()}
          className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-[var(--app-panel)] hover:text-[var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[var(--app-gold)] sm:right-5 sm:top-5">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <PremiumInfo language={language} titleId={titleId} />
      </div>
    </dialog>
  </>;
}
