// Canonical demo data. Imported from the authoritative demo-fixtures.json at the repo
// root (single source of truth — do not fork a second copy). The JSON's inferred type is
// looser than our domain model, so we assert it through the typed shape once here.
import type { FixturesFile, Fixture } from "./types";
import raw from "../demo-fixtures.json";

export const FIXTURES_FILE = raw as unknown as FixturesFile;
export const FIXTURES: Fixture[] = FIXTURES_FILE.fixtures;

export function fixtureById(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}
