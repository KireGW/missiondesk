"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save } from "lucide-react";
import type { PersonalPreferences } from "@/lib/product/profiles";
import { personalMessages } from "@/lib/product/messages";

export function ProfileSettings({ preferences }: { preferences: PersonalPreferences }) {
  const router = useRouter();
  const [draft, setDraft] = useState(preferences);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const t = personalMessages(preferences.language);
  const selectClass = "mt-2 w-full rounded-md border border-[var(--app-line)] bg-[var(--app-panel-strong)] px-3 py-2.5 text-[var(--app-fg)]";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await fetch("/api/personal/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("Profile not saved");
      setStatus("saved");
      router.refresh();
    } catch { setStatus("error"); }
  }
  return <form onSubmit={save} className="border-b border-[var(--app-line)] py-7">
    <h3 className="text-lg font-semibold">{t.profile}</h3>
    <fieldset disabled={status === "saving"} className="mt-5 grid gap-5 sm:grid-cols-2 disabled:opacity-60">
      <label className="min-w-0 text-sm">{t.homeCountry}
        <select name="homeCountry" value={draft.homeCountry} className={selectClass}
          onChange={(event) => { setDraft({ ...draft, homeCountry: event.target.value as PersonalPreferences["homeCountry"] }); setStatus("idle"); }}>
          <option value="SE">{t.sweden}</option><option value="NO">{t.norway}</option>
        </select>
      </label>
      <label className="min-w-0 text-sm">{t.language}
        <select name="language" value={draft.language} className={selectClass}
          onChange={(event) => { setDraft({ ...draft, language: event.target.value as PersonalPreferences["language"] }); setStatus("idle"); }}>
          <option value="sv">Svenska</option><option value="nb">Norsk (bokmål)</option>
        </select>
      </label>
      <div className="text-sm"><span className="text-[var(--app-muted)]">{t.targetCountry}</span><p className="mt-2">{t.mexico}</p></div>
    </fieldset>
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <button type="submit" disabled={status === "saving"} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--app-line)] px-4 py-2 text-sm hover:border-[var(--app-accent)] disabled:opacity-60">
        {status === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "saved" ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {status === "saving" ? t.saving : t.save}
      </button>
      <p role="status" className={`text-sm ${status === "error" ? "text-[var(--app-danger)]" : "text-[var(--app-positive)]"}`}>
        {status === "saved" ? t.saved : status === "error" ? t.saveError : ""}
      </p>
    </div>
  </form>;
}
