"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { countryNameSv } from "@/lib/i18n/countries";
import type { IntelligenceCategory, SourceDefinition } from "@/lib/types";

const categoryOptions: Array<{ id: IntelligenceCategory; label: string }> = [
  { id: "economy", label: "Ekonomi" },
  { id: "trade", label: "Handel" },
  { id: "domestic_politics", label: "Inrikespolitik" },
  { id: "foreign_policy", label: "Utrikespolitik" },
  { id: "sweden_connection", label: "Sverigekoppling" },
  { id: "security", label: "Säkerhet" },
  { id: "markets", label: "Marknader" },
  { id: "investment_climate", label: "Investeringsklimat" },
  { id: "migration", label: "Migration" },
  { id: "society", label: "Samhälle" },
  { id: "energy", label: "Energi" },
  { id: "technology", label: "Teknik" },
  { id: "culture_soft_power", label: "Kultur" },
];

const emptyForm = {
  name: "",
  url: "",
  country: "Mexiko",
  language: "es",
  categories: ["domestic_politics"] as IntelligenceCategory[],
  notes: "",
};

export function SourceManager({ initialSources }: { initialSources: SourceDefinition[] }) {
  const [sources, setSources] = useState<SourceDefinition[]>(initialSources);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<"ready" | "saving" | "error">("ready");
  const [query, setQuery] = useState("");

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sources;

    return sources.filter((source) =>
      [source.name, source.country, source.language, source.url, source.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, sources]);

  const enabledCount = sources.filter((source) => source.enabled).length;

  const toggleCategory = (id: IntelligenceCategory) => {
    setForm((current) => {
      const categories = current.categories.includes(id)
        ? current.categories.filter((category) => category !== id)
        : [...current.categories, id];

      return {
        ...current,
        categories: categories.length > 0 ? categories : ["domestic_politics"],
      };
    });
  };

  const addSource = async () => {
    setStatus("saving");
    const response = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        type: "rss",
        enabled: true,
        trustTier: 2,
      }),
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const payload = (await response.json()) as { sources: SourceDefinition[] };
    setSources(payload.sources);
    setForm(emptyForm);
    setStatus("ready");
  };

  const patchSource = async (source: SourceDefinition, patch: Partial<SourceDefinition>) => {
    const response = await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const payload = (await response.json()) as { sources: SourceDefinition[] };
    setSources(payload.sources);
    setStatus("ready");
  };

  const deleteSource = async (source: SourceDefinition) => {
    const response = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const payload = (await response.json()) as { sources: SourceDefinition[] };
    setSources(payload.sources);
    setStatus("ready");
  };

  const resetSourceList = async () => {
    setStatus("saving");
    const response = await fetch("/api/sources/reset", { method: "POST" });
    const payload = (await response.json()) as { sources: SourceDefinition[] };
    setSources(payload.sources);
    setStatus("ready");
  };

  return (
    <main className="missiondesk min-h-screen px-4 py-5 sm:px-6 lg:px-7">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header className="surface-strong rounded-lg p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-sm text-[var(--app-muted)] hover:text-[var(--app-accent)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Till dashboard
              </Link>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)]">
                  <Database className="h-5 w-5 text-[var(--app-accent)]" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                    MissionDesk
                  </p>
                  <h1 className="text-3xl font-semibold">Source Manager</h1>
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                Hantera seriösa källor för nyheter, myndighetsuppdateringar och
                institutionella signaler. Inga påhittade artiklar visas i dashboarden.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-[360px]">
              <Metric label="Aktiva källor" value={enabledCount} />
              <Metric label="Totalt" value={sources.length} />
            </div>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form
            className="surface rounded-lg p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void addSource();
            }}
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
              <Plus className="h-4 w-4 text-[var(--app-accent)]" />
              Lägg till RSS-källa
            </div>

            <div className="mt-5 grid gap-3">
              <Field
                label="Namn"
                value={form.name}
                onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                placeholder="Ex. El Norte"
              />
              <Field
                label="RSS URL"
                value={form.url}
                onChange={(value) => setForm((current) => ({ ...current, url: value }))}
                placeholder="https://example.com/feed"
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Land"
                  value={form.country}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, country: value }))
                  }
                />
                <Field
                  label="Språk"
                  value={form.language}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, language: value }))
                  }
                />
              </div>
              <Field
                label="Anteckning"
                value={form.notes}
                onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
                placeholder="Region, inriktning eller kommentar"
              />
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
              Teman
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryOptions.map((category) => {
                const active = form.categories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className={clsx(
                      "rounded-md border px-3 py-2 text-xs transition",
                      active
                        ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_82%)] text-[var(--app-accent-strong)]"
                        : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)]",
                    )}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={!form.name || !form.url || status === "saving"}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_82%)] px-4 py-3 text-sm font-medium text-[var(--app-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Lägg till källa
            </button>
          </form>

          <section className="surface rounded-lg">
            <div className="flex flex-col gap-3 border-b border-[var(--app-line)] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                  Aktiva och tillgängliga källor
                </p>
                <h2 className="mt-2 text-xl font-semibold">Källista</h2>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Sök källa"
                  className="min-h-10 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm outline-none placeholder:text-[var(--app-muted)]"
                />
                <button
                  type="button"
                  onClick={() => void resetSourceList()}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm text-[var(--app-soft)] hover:border-[var(--app-accent)]"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>

            <div className="divide-y divide-[var(--app-line)]">
              {filteredSources.map((source) => (
                <article
                  key={source.id}
                  className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{source.name}</span>
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                          source.enabled
                            ? "bg-[color-mix(in_srgb,var(--app-positive),transparent_84%)] text-[var(--app-positive)]"
                            : "bg-[var(--app-panel-muted)] text-[var(--app-muted)]",
                        )}
                      >
                        {source.enabled ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {source.enabled ? "Aktiv" : "Pausad"}
                      </span>
                    </div>
                    <p className="mt-2 break-all font-mono text-xs text-[var(--app-muted)]">
                      {source.url}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--app-muted)]">
                      <span>{countryNameSv(source.country) ?? source.country}</span>
                      <span>{source.language.toUpperCase()}</span>
                      <span>Tier {source.trustTier}</span>
                      {source.categories.map((category) => (
                        <span
                          key={category}
                          className="rounded border border-[var(--app-line)] px-2 py-1"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                    {source.notes && (
                      <p className="mt-3 text-sm leading-6 text-[var(--app-soft)]">
                        {source.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-start gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => void patchSource(source, { enabled: !source.enabled })}
                      className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-sm hover:border-[var(--app-accent)]"
                    >
                      {source.enabled ? "Pausa" : "Aktivera"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSource(source)}
                      className="rounded-md border border-[color-mix(in_srgb,var(--app-danger),transparent_45%)] bg-[color-mix(in_srgb,var(--app-danger),transparent_90%)] px-3 py-2 text-sm text-[var(--app-danger)]"
                      aria-label={`Ta bort ${source.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-10 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)]"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <span className="mt-2 block font-mono text-2xl font-semibold">{value}</span>
    </div>
  );
}
