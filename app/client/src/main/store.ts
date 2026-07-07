import { app, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Main-process key/value store for the exam write-ahead buffer and the
 * persisted client state-machine snapshot. Backs lib/buffer.ts in the renderer
 * over synchronous IPC (see preload `store` bridge), so the buffer's public API
 * stays synchronous exactly like the localStorage backend it replaces.
 *
 * Storage: Node 22 (Electron 39) ships the built-in `node:sqlite` module, used
 * here with no native dependency. If it is unavailable in a given build the
 * store falls back to a JSON file in userData with the identical interface.
 */

interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

function createSqliteStore(file: string): KV {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  const getStmt = db.prepare('SELECT v FROM kv WHERE k = ?')
  const setStmt = db.prepare(
    'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  )
  const delStmt = db.prepare('DELETE FROM kv WHERE k = ?')
  return {
    get: (key) => {
      const row = getStmt.get(key) as { v: string } | undefined
      return row ? row.v : null
    },
    set: (key, value) => {
      setStmt.run(key, value)
    },
    delete: (key) => {
      delStmt.run(key)
    }
  }
}

function createJsonStore(file: string): KV {
  // ponytail: whole-file rewrite. Data is a handful of small rows (session +
  // answers + status), so O(n) rewrites are fine; revisit only if it ever grows.
  let map: Record<string, string> = {}
  try {
    map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  } catch {
    map = {}
  }
  const flush = (): void => {
    try {
      writeFileSync(file, JSON.stringify(map))
    } catch {
      /* best-effort persistence */
    }
  }
  return {
    get: (key) => (key in map ? map[key] : null),
    set: (key, value) => {
      map[key] = value
      flush()
    },
    delete: (key) => {
      delete map[key]
      flush()
    }
  }
}

let store: KV | null = null

function getStore(): KV {
  if (store) return store
  const dir = app.getPath('userData')
  try {
    store = createSqliteStore(join(dir, 'wcl-buffer.sqlite'))
  } catch (error) {
    console.warn('[store] node:sqlite unavailable, falling back to JSON file:', error)
    store = createJsonStore(join(dir, 'wcl-buffer.json'))
  }
  return store
}

/** Register synchronous IPC handlers. Call once after app is ready. */
export function registerStoreIpc(): void {
  ipcMain.on('store:get', (event, key: string) => {
    event.returnValue = getStore().get(key)
  })
  ipcMain.on('store:set', (_event, payload: { key: string; value: string }) => {
    getStore().set(payload.key, payload.value)
  })
  ipcMain.on('store:delete', (_event, key: string) => {
    getStore().delete(key)
  })
}
