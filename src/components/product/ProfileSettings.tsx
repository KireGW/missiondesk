"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save } from "lucide-react";
import { interfaceLanguageNames, personalStations, type PersonalLanguage, type PersonalPreferences } from "@/lib/product/profiles";
import { personalMessages } from "@/lib/product/messages";

export function ProfileSettings({ preferences, interfaceLanguages }: { preferences: PersonalPreferences; interfaceLanguages: readonly PersonalLanguage[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(preferences);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const t = personalMessages(preferences.language);
  const station = personalStations[preferences.homeCountry];
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
      <div className="min-w-0 text-sm"><span className="text-[var(--app-muted)]">{t.station}</span>
        <p className="mt-2 leading-6">{t.stationNames[station.homeCountry]}</p>
      </div>
      <div className="min-w-0 text-sm"><span className="text-[var(--app-muted)]">{t.monitoredCountries}</span>
        <p className="mt-2 leading-6">{station.countries.map((country) => t.monitoredCountryNames[country]).join(", ")}</p>
      </div>
      <label className="min-w-0 text-sm">{t.interfaceLanguage}
        <select name="language" value={draft.language} className={selectClass}
          onChange={(event) => { setDraft({ ...draft, language: event.target.value as PersonalPreferences["language"] }); setStatus("idle"); }}>
          {interfaceLanguages.map((language) => <option key={language} value={language}>{interfaceLanguageNames[language]}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm">{t.signalTextLanguage}
        <select name="contentLanguage" value={draft.contentLanguage} className={selectClass}
          onChange={(event) => { setDraft({ ...draft, contentLanguage: event.target.value as PersonalPreferences["contentLanguage"] }); setStatus("idle"); }}>
          <option value="original">{t.originalLanguage}</option>
          <option value="sv">{t.cachedSwedishSummaries}</option>
        </select>
      </label>
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
