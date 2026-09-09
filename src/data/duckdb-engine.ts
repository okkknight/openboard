import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { CompiledQuery, ColumnProfile, DatasetSpec, JsonObject, JsonValue } from "../core/types.js";

export interface QueryResult {
  columns: string[];
  rows: JsonObject[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isReadOnly(sql: string): boolean {
  const normalized = sql.replaceAll(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").trim().toUpperCase();
  return /^(SELECT|WITH|DESCRIBE|SUMMARIZE|EXPLAIN)\b/.test(normalized);
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return String(value);
}

export class DuckDbEngine {
  #instance?: Promise<DuckDBInstance>;
  #connection?: Promise<DuckDBConnection>;

  async inspect(dataset: DatasetSpec): Promise<DatasetSpec> {
    const connection = await this.#getConnection();
    await this.#register(dataset);
    const description = await connection.run(`DESCRIBE ${quoteIdentifier(dataset.id)}`);
    const rows = await description.getRowObjectsJS();
    const count = await connection.run(`SELECT COUNT(*) AS "row_count" FROM ${quoteIdentifier(dataset.id)}`);
    const countRows = await count.getRowObjectsJS();
    const columns: ColumnProfile[] = rows.map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullable: String(row.null).toUpperCase() !== "NO"
    }));
    return { ...dataset, row_count: Number(countRows[0].row_count), columns };
  }

  async query(dataset: DatasetSpec, compiled: CompiledQuery): Promise<QueryResult> {
    await this.#register(dataset);
    const connection = await this.#getConnection();
    const result = await connection.run(compiled.sql, compiled.params);
    const rows = (await result.getRowObjectsJS()).map((row) => jsonValue(row) as JsonObject);
    return { columns: result.columnNames(), rows };
  }

  async queryRaw(dataset: DatasetSpec, sql: string): Promise<QueryResult> {
    if (!isReadOnly(sql)) throw new Error("query_rejected: read-only SQL required");
    await this.#register(dataset);
    const connection = await this.#getConnection();
    const result = await connection.run(sql);
    const rows = (await result.getRowObjectsJS()).map((row) => jsonValue(row) as JsonObject);
    return { columns: result.columnNames(), rows };
  }

  close(): void {
    void this.#connection?.then((connection) => connection.closeSync());
    void this.#instance?.then((instance) => instance.closeSync());
  }

  async #getConnection(): Promise<DuckDBConnection> {
    if (!this.#instance) this.#instance = DuckDBInstance.create(":memory:");
    if (!this.#connection) this.#connection = this.#instance.then((instance) => instance.connect());
    return this.#connection;
  }

  async #register(dataset: DatasetSpec): Promise<void> {
    const connection = await this.#getConnection();
    const reader = dataset.format === "csv" ? "read_csv_auto" : "read_parquet";
    await connection.run(`CREATE OR REPLACE TEMP VIEW ${quoteIdentifier(dataset.id)} AS SELECT * FROM ${reader}(${quoteString(dataset.path)})`);
  }
}
