import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../database/schema'

let database: ReturnType<typeof createDatabase> | undefined

function createDatabase() {
  const url = process.env.DATABASE_URL || 'postgres://acme:acme@127.0.0.1:5432/acme'
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: false })
  return drizzle(client, { schema })
}

export function useDatabase() {
  database ||= createDatabase()
  return database
}
