import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoredEvent =
  | {
      id: string;
      event: "issues";
      action: "opened" | "edited" | "closed" | "reopened";
      repository: string;
      issue_number: number;
      timestamp: string;
    }
  | {
      id: string;
      event: "issue_comment";
      action: "created" | "edited" | "deleted";
      repository: string;
      issue_number: number;
      comment_id: number;
      timestamp: string;
    }
  | {
      id: string;
      event: "ping";
      action: "ping";
      repository: string;
      issue_number: null;
      timestamp: string;
    };

export interface EventStore {
  insert(event: StoredEvent): boolean;
  list(limit: number): StoredEvent[];
  close(): void;
}

interface EventRow {
  delivery_id: string;
  event: StoredEvent["event"];
  action: StoredEvent["action"];
  repository: string;
  issue_number: number | null;
  comment_id: number | null;
  timestamp: string;
}

function toStoredEvent(row: EventRow): StoredEvent {
  if (row.event === "ping") {
    return {
      id: row.delivery_id,
      event: "ping",
      action: "ping",
      repository: row.repository,
      issue_number: null,
      timestamp: row.timestamp,
    };
  }

  if (row.event === "issue_comment") {
    return {
      id: row.delivery_id,
      event: "issue_comment",
      action: row.action as "created" | "edited" | "deleted",
      repository: row.repository,
      issue_number: row.issue_number as number,
      comment_id: row.comment_id as number,
      timestamp: row.timestamp,
    };
  }

  return {
    id: row.delivery_id,
    event: "issues",
    action: row.action as "opened" | "edited" | "closed" | "reopened",
    repository: row.repository,
    issue_number: row.issue_number as number,
    timestamp: row.timestamp,
  };
}

export class SqliteEventStore implements EventStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS webhook_events (
        delivery_id TEXT NOT NULL,
        event TEXT NOT NULL,
        action TEXT NOT NULL,
        repository TEXT NOT NULL,
        issue_number INTEGER,
        comment_id INTEGER,
        timestamp TEXT NOT NULL,
        UNIQUE(delivery_id, action)
      );
    `);
  }

  insert(event: StoredEvent): boolean {
    const result = this.database
      .prepare(`
        INSERT INTO webhook_events (
          delivery_id,
          event,
          action,
          repository,
          issue_number,
          comment_id,
          timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(delivery_id, action) DO NOTHING
      `)
      .run(
        event.id,
        event.event,
        event.action,
        event.repository,
        event.issue_number,
        "comment_id" in event ? event.comment_id : null,
        event.timestamp,
      );

    return Number(result.changes) === 1;
  }

  list(limit: number): StoredEvent[] {
    const rows = this.database
      .prepare(`
        SELECT
          delivery_id,
          event,
          action,
          repository,
          issue_number,
          comment_id,
          timestamp
        FROM webhook_events
        ORDER BY timestamp DESC, rowid DESC
        LIMIT ?
      `)
      .all(limit) as unknown as EventRow[];

    return rows.map(toStoredEvent);
  }

  close(): void {
    this.database.close();
  }
}
