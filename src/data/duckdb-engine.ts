import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { CompiledQuery, ColumnProfile, DatasetSpec, JsonObject, JsonValue } from "../core/types.js";
import { DatasetMetadataCache, type DatasetFingerprint } from "./dataset-metadata-cache.js";

export interface QueryResult {
  columns: string[];
  rows: JsonObject[];
}

export interface GuardedQueryResult extends QueryResult { exceeded: boolean; }

/** A physical DuckDB result chunk; rows have already crossed the database boundary. */
export interface QueryChunk extends QueryResult {}

export interface InspectOptions {
  fields?: string[];
  top_k?: number;
  sample_rows?: number;
}

export interface DatasetInspection extends DatasetSpec {
  top_values: Record<string, Array<{ value: JsonValue; count: number }>>;
  sample_rows: JsonObject[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const READ_ONLY_START = new Set(["SELECT", "WITH", "DESCRIBE", "SUMMARIZE", "EXPLAIN"]);
const MUTATING_KEYWORDS = new Set(["ALTER", "ATTACH", "CALL", "COPY", "CREATE", "DELETE", "DETACH", "DROP", "EXPORT", "IMPORT", "INSERT", "INSTALL", "LOAD", "MERGE", "PRAGMA", "REPLACE", "RESET", "SET", "TRUNCATE", "UPDATE", "USE", "VACUUM"]);

/**
 * A small fail-closed SQL lexer. It deliberately understands only enough SQL
 * to reject write-capable statements before DuckDB sees them; identifiers and
 * quoted values are ignored so their text cannot accidentally look like a
 * mutating keyword.
 */
function readOnlyTokens(sql: string): { tokens: string[]; statementCount: number } {
  const tokens: string[] = [];
  let statementCount = 0;
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "-" && sql[index + 1] === "-") { index = sql.indexOf("\n", index + 2); if (index < 0) break; continue; }
    if (char === "/" && sql[index + 1] === "*") { const end = sql.indexOf("*/", index + 2); if (end < 0) return { tokens: [], statementCount: 2 }; index = end + 2; continue; }
    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote && sql[index + 1] === quote) { index += 2; continue; }
        if (sql[index] === quote) { index += 1; break; }
        index += 1;
      }
      if (index > sql.length) return { tokens: [], statementCount: 2 };
      continue;
    }
    if (char === ";") { statementCount += 1; index += 1; continue; }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      tokens.push(sql.slice(start, index).toUpperCase());
      continue;
    }
    index += 1;
  }
  return { tokens, statementCount };
}

function isReadOnly(sql: string): boolean {
  const { tokens, statementCount } = readOnlyTokens(sql);
  return statementCount <= 1 && tokens.length > 0 && READ_ONLY_START.has(tokens[0]) && !tokens.some((token) => MUTATING_KEYWORDS.has(token));
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
  #metadata = new DatasetMetadataCache();

  async fingerprint(dataset: DatasetSpec): Promise<DatasetFingerprint> { return this.#metadata.fingerprint(dataset); }

  async describeSchema(dataset: DatasetSpec): Promise<ColumnProfile[]> {
    return this.#metadata.schema(dataset, async () => {
      const connection = await this.#getConnection();
      await this.#register(dataset);
      const description = await connection.run(`DESCRIBE ${quoteIdentifier(dataset.id)}`);
      const rows = await description.getRowObjectsJS();
      return rows.map((row) => ({
        name: String(row.column_name),
        type: String(row.column_type),
        nullable: String(row.null).toUpperCase() !== "NO"
      }));
    });
  }

  async inspectProfile(dataset: DatasetSpec, options: InspectOptions = {}): Promise<DatasetInspection> {
    const connection = await this.#getConnection();
    await this.#register(dataset);
    const columns = await this.describeSchema(dataset);
    const count = await connection.run(`SELECT COUNT(*) AS "row_count" FROM ${quoteIdentifier(dataset.id)}`);
    const countRows = await count.getRowObjectsJS();
    const knownFields = new Set(columns.map((column) => column.name));
    const fields = options.fields ?? columns.map((column) => column.name);
    if (fields.some((field) => !knownFields.has(field))) throw new Error(`unknown_column: ${fields.find((field) => !knownFields.has(field))}`);
    const topK = options.top_k ?? 10;
    const sampleRows = options.sample_rows ?? 5;
    if (!Number.isInteger(topK) || topK < 1 || topK > 50) throw new Error("invalid_top_k");
    if (!Number.isInteger(sampleRows) || sampleRows < 0 || sampleRows > 100) throw new Error("invalid_sample_rows");
    const top_values: DatasetInspection["top_values"] = {};
    for (const field of fields) {
      const values = await connection.run(`SELECT ${quoteIdentifier(field)} AS "value", COUNT(*) AS "count" FROM ${quoteIdentifier(dataset.id)} GROUP BY 1 ORDER BY "count" DESC NULLS LAST LIMIT ${topK}`);
      top_values[field] = (await values.getRowObjectsJS()).map((row) => ({ value: jsonValue(row.value), count: Number(row.count) }));
    }
    const sample = await connection.run(`SELECT * FROM ${quoteIdentifier(dataset.id)} LIMIT ${sampleRows}`);
    const sample_rows = (await sample.getRowObjectsJS()).map((row) => jsonValue(row) as JsonObject);
    return { ...dataset, row_count: Number(countRows[0].row_count), columns, top_values, sample_rows };
  }

  async inspect(dataset: DatasetSpec, options: InspectOptions = {}): Promise<DatasetInspection> {
    return this.inspectProfile(dataset, options);
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

  async queryGuarded(dataset: DatasetSpec, compiled: CompiledQuery, maxRows: number): Promise<GuardedQueryResult> {
    return this.#queryGuarded(dataset, compiled.sql, maxRows, compiled.params);
  }

  async queryRawGuarded(dataset: DatasetSpec, sql: string, maxRows: number): Promise<GuardedQueryResult> {
    if (!isReadOnly(sql)) throw new Error("query_rejected: read-only SQL required");
    return this.#queryGuarded(dataset, sql, maxRows);
  }

  async *stream(dataset: DatasetSpec, compiled: CompiledQuery): AsyncGenerator<QueryChunk> {
    yield* this.#stream(dataset, compiled.sql, compiled.params);
  }

  async *streamRaw(dataset: DatasetSpec, sql: string): AsyncGenerator<QueryChunk> {
    if (!isReadOnly(sql)) throw new Error("query_rejected: read-only SQL required");
    yield* this.#stream(dataset, sql);
  }

  async count(dataset: DatasetSpec, compiled: CompiledQuery): Promise<number> {
    return this.#count(dataset, compiled.sql, compiled.params);
  }

  async countRaw(dataset: DatasetSpec, sql: string): Promise<number> {
    if (!isReadOnly(sql)) throw new Error("query_rejected: read-only SQL required");
    return this.#count(dataset, sql);
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
    const fingerprint = await this.#metadata.fingerprint(dataset);
    if (await this.#metadata.isRegistered(dataset)) return;
    const connection = await this.#getConnection();
    const reader = dataset.format === "csv" ? "read_csv_auto" : "read_parquet";
    await connection.run(`CREATE OR REPLACE TEMP VIEW ${quoteIdentifier(dataset.id)} AS SELECT * FROM ${reader}(${quoteString(dataset.path)})`);
    this.#metadata.markRegistered(fingerprint.key);
  }

  async *#stream(dataset: DatasetSpec, sql: string, params?: CompiledQuery["params"]): AsyncGenerator<QueryChunk> {
    await this.#register(dataset);
    const connection = await this.#getConnection();
    const result = await connection.stream(sql, params);
    const columns = result.columnNames();
    for await (const rows of result.yieldRowObjectJs()) {
      yield { columns, rows: rows.map((row) => jsonValue(row) as JsonObject) };
    }
  }

  async #count(dataset: DatasetSpec, sql: string, params?: CompiledQuery["params"]): Promise<number> {
    await this.#register(dataset);
    const connection = await this.#getConnection();
    const result = await connection.run(`SELECT COUNT(*) AS "row_count" FROM (${sql}) AS "_result"`, params);
    const [row] = await result.getRowObjectsJS();
    return Number(row?.row_count ?? 0);
  }

  async #queryGuarded(dataset: DatasetSpec, sql: string, maxRows: number, params?: CompiledQuery["params"]): Promise<GuardedQueryResult> {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new Error("invalid_query_limit");
    await this.#register(dataset);
    const connection = await this.#getConnection();
    const result = await connection.run(`SELECT * FROM (${sql}) AS "_guarded" LIMIT ${maxRows + 1}`, params);
    const rows = (await result.getRowObjectsJS()).map((row) => jsonValue(row) as JsonObject);
    if (rows.length > maxRows) return { columns: result.columnNames(), rows: [], exceeded: true };
    return { columns: result.columnNames(), rows, exceeded: false };
  }
}
