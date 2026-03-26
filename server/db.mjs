import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'

import { createDefaultUserData } from './defaults.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const resolveDatabasePath = () => {
  const configuredPath = process.env.DATABASE_PATH || path.join(rootDir, '.data', 'kinopio-selfhost.sqlite')
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(rootDir, configuredPath)
}

const ensureDirectory = (targetPath) => {
  const directory = path.dirname(targetPath)
  fs.mkdirSync(directory, { recursive: true })
}

const now = () => new Date().toISOString()

const parseJson = (value, fallback = {}) => {
  if (!value) { return fallback }
  try {
    return JSON.parse(value)
  } catch (error) {
    return fallback
  }
}

const ensureSpaceShape = (space = {}) => {
  const stableId = space.id || nanoid()
  return {
    cards: [],
    connections: [],
    connectionTypes: [],
    boxes: [],
    lists: [],
    lines: [],
    drawingStrokes: [],
    users: [],
    collaborators: [],
    spectators: [],
    clients: [],
    tags: [],
    removedCards: [],
    privacy: 'private',
    ...space,
    id: stableId,
    url: stableId,
    cards: space.cards || [],
    connections: space.connections || [],
    connectionTypes: space.connectionTypes || [],
    boxes: space.boxes || [],
    lists: space.lists || [],
    lines: space.lines || [],
    drawingStrokes: space.drawingStrokes || [],
    users: space.users || [],
    collaborators: space.collaborators || [],
    spectators: space.spectators || [],
    clients: [],
    tags: space.tags || [],
    removedCards: space.removedCards || []
  }
}

const mapUserRow = (row) => {
  if (!row) { return null }
  const data = parseJson(row.data_json)
  return {
    ...data,
    id: row.id,
    email: row.email,
    apiKey: row.api_key
  }
}

const mapSpaceRow = (row) => {
  if (!row) { return null }
  const data = parseJson(row.data_json)
  return ensureSpaceShape({
    ...data,
    id: row.id,
    userId: row.user_id,
    name: row.name,
    privacy: row.privacy || data.privacy || 'private',
    isRemoved: Boolean(row.is_removed),
    createdAt: row.created_at || data.createdAt || now(),
    updatedAt: row.updated_at || data.updatedAt || now(),
    editedAt: data.editedAt || row.updated_at || now()
  })
}

const databasePath = resolveDatabasePath()
ensureDirectory(databasePath)

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    api_key TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    privacy TEXT,
    is_removed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    key TEXT PRIMARY KEY,
    space_id TEXT,
    owner_id TEXT,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
  );
`)

const getUserRowByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?')
const getUserRowByApiKeyStmt = db.prepare('SELECT * FROM users WHERE api_key = ?')
const getFirstUserRowStmt = db.prepare('SELECT * FROM users LIMIT 1')
const insertUserStmt = db.prepare(`
  INSERT INTO users (id, email, password_hash, api_key, data_json, created_at, updated_at)
  VALUES (@id, @email, @password_hash, @api_key, @data_json, @created_at, @updated_at)
`)
const updateUserStmt = db.prepare(`
  UPDATE users
  SET email = @email,
      password_hash = @password_hash,
      api_key = @api_key,
      data_json = @data_json,
      updated_at = @updated_at
  WHERE id = @id
`)
const upsertSpaceStmt = db.prepare(`
  INSERT INTO spaces (id, user_id, name, privacy, is_removed, created_at, updated_at, data_json)
  VALUES (@id, @user_id, @name, @privacy, @is_removed, @created_at, @updated_at, @data_json)
  ON CONFLICT(id) DO UPDATE SET
    user_id = excluded.user_id,
    name = excluded.name,
    privacy = excluded.privacy,
    is_removed = excluded.is_removed,
    updated_at = excluded.updated_at,
    data_json = excluded.data_json
`)
const getSpaceRowStmt = db.prepare('SELECT * FROM spaces WHERE id = ?')
const listSpacesStmt = db.prepare('SELECT * FROM spaces WHERE is_removed = 0 ORDER BY updated_at DESC')
const listRemovedSpacesStmt = db.prepare('SELECT * FROM spaces WHERE is_removed = 1 ORDER BY updated_at DESC')
const deleteSpaceStmt = db.prepare('DELETE FROM spaces WHERE id = ?')
const upsertAssetStmt = db.prepare(`
  INSERT INTO assets (key, space_id, owner_id, file_name, mime_type, size, data, created_at)
  VALUES (@key, @space_id, @owner_id, @file_name, @mime_type, @size, @data, @created_at)
  ON CONFLICT(key) DO UPDATE SET
    space_id = excluded.space_id,
    owner_id = excluded.owner_id,
    file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    size = excluded.size,
    data = excluded.data,
    created_at = excluded.created_at
`)
const getAssetStmt = db.prepare('SELECT * FROM assets WHERE key = ?')

export const seedAdminUser = () => {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com'
  const password = process.env.ADMIN_PASSWORD || 'change-me-now'
  const existingRow = getUserRowByEmailStmt.get(email) || getFirstUserRowStmt.get()
  const passwordHash = bcrypt.hashSync(password, 10)

  if (!existingRow) {
    const id = nanoid()
    const apiKey = nanoid(32)
    const data = createDefaultUserData({ id, email, apiKey })
    const timestamp = now()
    insertUserStmt.run({
      id,
      email,
      password_hash: passwordHash,
      api_key: apiKey,
      data_json: JSON.stringify(data),
      created_at: timestamp,
      updated_at: timestamp
    })
    return mapUserRow(getUserRowByEmailStmt.get(email))
  }

  const data = {
    ...createDefaultUserData({ id: existingRow.id, email, apiKey: existingRow.api_key }),
    ...parseJson(existingRow.data_json),
    id: existingRow.id,
    email,
    apiKey: existingRow.api_key,
    isUpgraded: true
  }

  updateUserStmt.run({
    id: existingRow.id,
    email,
    password_hash: passwordHash,
    api_key: existingRow.api_key,
    data_json: JSON.stringify(data),
    updated_at: now()
  })

  return mapUserRow(getUserRowByApiKeyStmt.get(existingRow.api_key))
}

export const getAdminUserByEmail = (email) => mapUserRow(getUserRowByEmailStmt.get(email))
export const getAdminUserByApiKey = (apiKey) => mapUserRow(getUserRowByApiKeyStmt.get(apiKey))

export const verifyPassword = (email, password) => {
  const row = getUserRowByEmailStmt.get(email)
  if (!row) { return false }
  return bcrypt.compareSync(password, row.password_hash)
}

export const saveUser = (user) => {
  const timestamp = now()
  const data = {
    ...createDefaultUserData({ id: user.id, email: user.email, apiKey: user.apiKey }),
    ...user,
    isUpgraded: true
  }
  const existing = getUserRowByEmailStmt.get(user.email) || getUserRowByApiKeyStmt.get(user.apiKey)
  if (existing) {
    updateUserStmt.run({
      id: existing.id,
      email: user.email,
      password_hash: existing.password_hash,
      api_key: user.apiKey,
      data_json: JSON.stringify(data),
      updated_at: timestamp
    })
    return getAdminUserByApiKey(user.apiKey)
  }
  insertUserStmt.run({
    id: user.id,
    email: user.email,
    password_hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'change-me-now', 10),
    api_key: user.apiKey,
    data_json: JSON.stringify(data),
    created_at: timestamp,
    updated_at: timestamp
  })
  return getAdminUserByApiKey(user.apiKey)
}

export const listSpaces = ({ includeRemoved = false } = {}) => {
  const rows = includeRemoved ? listRemovedSpacesStmt.all() : listSpacesStmt.all()
  return rows.map(mapSpaceRow)
}

export const getSpace = (spaceId) => mapSpaceRow(getSpaceRowStmt.get(spaceId))

export const saveSpace = (space) => {
  const normalized = ensureSpaceShape(space)
  const timestamp = normalized.updatedAt || normalized.editedAt || now()
  upsertSpaceStmt.run({
    id: normalized.id,
    user_id: normalized.userId || normalized.users?.[0]?.id || seedAdminUser().id,
    name: normalized.name || normalized.id,
    privacy: normalized.privacy || 'private',
    is_removed: normalized.isRemoved ? 1 : 0,
    created_at: normalized.createdAt || timestamp,
    updated_at: timestamp,
    data_json: JSON.stringify(normalized)
  })
  return getSpace(normalized.id)
}

export const deleteSpace = (spaceId) => deleteSpaceStmt.run(spaceId)

export const saveAsset = ({ key, fileName, mimeType, size, data, spaceId, ownerId }) => {
  upsertAssetStmt.run({
    key,
    space_id: spaceId || null,
    owner_id: ownerId || null,
    file_name: fileName,
    mime_type: mimeType,
    size,
    data,
    created_at: now()
  })
}

export const getAssetByKey = (key) => getAssetStmt.get(key)

export const getDatabasePath = () => databasePath
