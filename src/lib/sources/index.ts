import "server-only";
import { pubmed } from "./pubmed";
import { openalex } from "./openalex";
import type { SearchAdapter, SearchDatabase } from "./types";

export const adapters: Record<SearchDatabase, SearchAdapter> = { pubmed, openalex };
