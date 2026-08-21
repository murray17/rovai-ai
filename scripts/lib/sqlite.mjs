import { DatabaseSync } from 'node:sqlite'

export function executeSqlite(databasePath, sql) {
  return withDatabase(databasePath, (database) => database.exec(sql))
}

export function querySqliteRows(databasePath, sql) {
  return withDatabase(databasePath, (database) => database.prepare(sql).all())
}

export function querySqliteScalar(databasePath, sql) {
  const rows = querySqliteRows(databasePath, sql)
  const row = rows[0]
  if (!row) return null
  return Object.values(row)[0] ?? null
}

function withDatabase(databasePath, operation) {
  const database = new DatabaseSync(databasePath)
  try {
    return operation(database)
  } finally {
    database.close()
  }
}
