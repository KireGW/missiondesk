import type { IntelligenceItem } from "@/lib/types";

export type PersonalSelectionKind = "priority" | "meeting";
export interface PersonalSelections {
  accountId: string;
  revision: string;
  priorities: string[];
  meeting: string[];
  retained: Record<string, IntelligenceItem>;
  bookmarkOnlyIds: string[];
}
export type PersonalSelectionChange = { kind: PersonalSelectionKind; itemId: string; selected: boolean }
  | { kind: "meeting"; clear: true; revision: string };

export const validSelectionId = (value: unknown): value is string => typeof value === "string"
  && /^(?:workspace:[a-f0-9]{64}|processed-[a-zA-Z0-9_-]{1,160})$/.test(value);
export const validSelectionRevision = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]{0,18})$/.test(value);
export function parsePersonalSelectionChange(value: unknown): PersonalSelectionChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string,unknown>;
  if (body.kind === "meeting" && body.clear === true && validSelectionRevision(body.revision)
    && Object.keys(body).sort().join(",") === "clear,kind,revision") return { kind: "meeting", clear: true, revision: body.revision };
  if ((body.kind !== "priority" && body.kind !== "meeting") || !validSelectionId(body.itemId) || typeof body.selected !== "boolean"
    || Object.keys(body).sort().join(",") !== "itemId,kind,selected") return null;
  return { kind: body.kind, itemId: body.itemId, selected: body.selected };
}

export function emptyPersonalSelections(accountId: string): PersonalSelections {
  return { accountId, revision: "0", priorities: [], meeting: [], retained: {}, bookmarkOnlyIds: [] };
}
