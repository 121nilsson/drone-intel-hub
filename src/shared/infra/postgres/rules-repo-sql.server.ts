import type { JSONValue } from "postgres";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import { db } from "./db.server";

/** Wraps a value as jsonb after stripping what PostgreSQL rejects (NUL bytes, lone surrogates). */
export const json = (v: unknown) => db().json(sanitizeJson(v as JSONValue));
