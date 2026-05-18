import { swedenMexicoIngestionSources } from "@/lib/ingestion/source-catalog";
import type { SourceDefinition } from "@/lib/types";

export const defaultSources: SourceDefinition[] = swedenMexicoIngestionSources.map((source) => ({
  ...source,
}));
