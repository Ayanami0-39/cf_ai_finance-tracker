/** Keep each statement below D1's 100-bound-parameter limit and reduce query counts. */
export function insertStatements(
  db: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictClause = ''
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const size = Math.floor(90 / columns.length);
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = rows.slice(offset, offset + size);
    statements.push(db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')} ${conflictClause}`
    ).bind(...chunk.flat()));
  }
  return statements;
}
