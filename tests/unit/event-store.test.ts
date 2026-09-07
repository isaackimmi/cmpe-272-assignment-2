import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteEventStore, type StoredEvent } from "../../src/store/events";

describe("SqliteEventStore", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps delivery/action deduplication across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "assignment-2-events-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "events.sqlite");
    const event: StoredEvent = {
      id: "delivery-1",
      event: "issues",
      action: "opened",
      repository: "owner/repo",
      issue_number: 42,
      timestamp: "2026-09-07T00:00:00.000Z",
    };

    const firstStore = new SqliteEventStore(databasePath);
    expect(firstStore.insert(event)).toBe(true);
    firstStore.close();

    const reopenedStore = new SqliteEventStore(databasePath);
    expect(reopenedStore.insert(event)).toBe(false);
    expect(reopenedStore.list(10)).toEqual([event]);
    reopenedStore.close();
  });
});
