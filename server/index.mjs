import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { nanoid } from 'nanoid'

import express from 'express'
import multer from 'multer'

import { emojiPayload } from './defaults.mjs'
import {
  seedAdminUser,
  getAdminUserByApiKey,
  getAdminUserByEmail,
  verifyPassword,
  saveUser,
  listSpaces,
  getSpace,
  saveSpace,
  saveAsset,
  getAssetByKey,
  getDatabasePath
} from './db.mjs'
import { applyOperations } from './operations.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024 * 1024 } })
const app = express()

app.set('trust proxy', true)
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

const adminUser = seedAdminUser()

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  color: user.color,
  description: user.description,
  website: user.website,
  isUpgraded: true
})

const requestOrigin = (req) => {
  return process.env.VITE_PUBLIC_APP_ORIGIN || `${req.protocol}://${req.get('host')}`
}

const authUser = (req) => {
  const apiKey = req.get('Authorization')
  if (!apiKey) { return null }
  return getAdminUserByApiKey(apiKey)
}

const requireAuth = (req, res, next) => {
  const user = authUser(req)
  if (!user) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  req.user = user
  next()
}

const canViewSpace = (req, space) => {
  if (!space) { return false }
  if (authUser(req)) { return true }
  const readOnlyKey = req.get('Read-Only-Authorization')
  if (readOnlyKey && space.readOnlyKey === readOnlyKey) {
    return true
  }
  return space.privacy !== 'private'
}

const listActiveSpaces = () => listSpaces().filter(space => !space.isRemoved)
const listRemovedSpaces = () => listSpaces({ includeRemoved: true }).filter(space => space.isRemoved)
const createInboxSpace = () => saveSpace({
  id: nanoid(),
  name: 'Inbox',
  privacy: 'private',
  showInExplore: false,
  collaboratorKey: nanoid(),
  readOnlyKey: nanoid(),
  users: [publicUser(adminUser)],
  collaborators: [],
  spectators: [],
  clients: [],
  background: '',
  backgroundTint: '',
  backgroundGradient: null,
  backgroundIsGradient: false,
  isTemplate: false,
  cards: [],
  connections: [],
  connectionTypes: [],
  cacheDate: Date.now(),
  removedCards: [],
  originSpaceId: '',
  tags: [],
  boxes: [],
  lines: [],
  lists: [],
  visits: 0,
  isRemoved: false,
  groupId: null,
  group: null,
  drawingStrokes: [],
  drawingImage: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  editedAt: new Date().toISOString(),
  userId: adminUser.id
})

const ensureInboxSpace = () => {
  const existingInbox = listActiveSpaces().find(space => space.name === 'Inbox')
  if (existingInbox) { return existingInbox }
  return createInboxSpace()
}

const replaceHtmlEntities = (value = '') => {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

const stripTags = (value = '') => {
  return replaceHtmlEntities(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
}

const extractFirstMatch = (text, patterns) => {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return stripTags(match[1])
    }
  }
  return ''
}

const extractAttribute = (tag, attributeName) => {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*(['"])(.*?)\\1`, 'i')
  return tag.match(pattern)?.[2] || ''
}

const extractMetaContent = (html, names) => {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || []
  const targetNames = names.map(name => name.toLowerCase())
  for (const tag of metaTags) {
    const property = extractAttribute(tag, 'property').toLowerCase()
    const name = extractAttribute(tag, 'name').toLowerCase()
    if (!targetNames.includes(property) && !targetNames.includes(name)) { continue }
    const content = extractAttribute(tag, 'content')
    if (content) {
      return stripTags(content)
    }
  }
  return ''
}

const extractLinkHref = (html, relValues) => {
  const linkTags = html.match(/<link\b[^>]*>/gi) || []
  const targets = relValues.map(value => value.toLowerCase())
  for (const tag of linkTags) {
    const rel = extractAttribute(tag, 'rel').toLowerCase()
    if (!targets.some(target => rel.includes(target))) { continue }
    const href = extractAttribute(tag, 'href')
    if (href) {
      return href
    }
  }
  return ''
}

const absoluteUrl = (baseUrl, inputUrl) => {
  if (!inputUrl) { return '' }
  try {
    return new URL(inputUrl, baseUrl).toString()
  } catch (error) {
    return ''
  }
}

const hostnameIsPrivate = (hostname = '') => {
  const value = hostname.toLowerCase()
  if (!value) { return true }
  if (['localhost', '127.0.0.1', '::1'].includes(value)) { return true }
  if (value.endsWith('.local')) { return true }
  if (/^10\.\d+\.\d+\.\d+$/.test(value)) { return true }
  if (/^127\.\d+\.\d+\.\d+$/.test(value)) { return true }
  if (/^192\.168\.\d+\.\d+$/.test(value)) { return true }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(value)) { return true }
  if (/^\[?::1\]?$/.test(value)) { return true }
  return false
}

const timedFetch = async (url, options = {}, timeoutMs = 5000) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

const youtubeVideoId = (url) => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0]
      if (id) {
        return id
      }
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v')
        if (id) {
          return id
        }
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/').filter(Boolean)[1]
        if (id) {
          return id
        }
      }
      if (parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.split('/').filter(Boolean)[1]
        if (id) {
          return id
        }
      }
    }
  } catch (error) {
    return ''
  }
  return ''
}

const youtubeEmbedUrl = (url) => {
  const id = youtubeVideoId(url)
  if (!id) { return '' }
  return `https://www.youtube.com/embed/${id}?rel=0`
}

const fetchYoutubePreviewMetadata = async (inputUrl) => {
  const parsedUrl = new URL(inputUrl)
  const videoId = youtubeVideoId(parsedUrl.toString())
  if (!videoId) { return null }

  const preview = {
    urlPreviewUrl: parsedUrl.toString(),
    urlPreviewTitle: 'YouTube Video',
    urlPreviewDescription: '',
    urlPreviewImage: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    urlPreviewFavicon: 'https://www.youtube.com/favicon.ico',
    urlPreviewEmbedHtml: '',
    urlPreviewIframeUrl: `https://www.youtube.com/embed/${videoId}?rel=0`
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(parsedUrl.toString())}`
    const response = await timedFetch(oembedUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'kinopio-selfhost/1.0'
      }
    })
    if (response.ok) {
      const data = await response.json()
      preview.urlPreviewTitle = stripTags(data.title || preview.urlPreviewTitle)
      preview.urlPreviewDescription = stripTags(data.author_name || '')
      preview.urlPreviewImage = data.thumbnail_url || preview.urlPreviewImage
    }
  } catch (error) {
    // Fall back to deterministic thumbnail/embed without failing the preview.
  }

  return preview
}

const fetchUrlPreviewMetadata = async (inputUrl) => {
  const parsedUrl = new URL(inputUrl)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Unsupported URL protocol')
  }
  if (hostnameIsPrivate(parsedUrl.hostname)) {
    throw new Error('Refusing to fetch private or local URL metadata')
  }

  const youtubePreview = await fetchYoutubePreviewMetadata(parsedUrl.toString())
  if (youtubePreview) {
    return youtubePreview
  }

  const response = await timedFetch(parsedUrl.toString(), {
    redirect: 'follow',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'kinopio-selfhost/1.0'
    }
  })
  if (!response.ok) {
    throw new Error(`Metadata fetch failed with status ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return {
      urlPreviewUrl: parsedUrl.toString(),
      urlPreviewTitle: parsedUrl.hostname,
      urlPreviewDescription: '',
      urlPreviewImage: '',
      urlPreviewFavicon: '',
      urlPreviewEmbedHtml: '',
      urlPreviewIframeUrl: youtubeEmbedUrl(parsedUrl.toString())
    }
  }

  const html = (await response.text()).slice(0, 300000)
  const resolvedUrl = response.url || parsedUrl.toString()
  const title = extractMetaContent(html, ['og:title', 'twitter:title']) ||
    extractFirstMatch(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]) ||
    parsedUrl.hostname
  const description = extractMetaContent(html, ['og:description', 'twitter:description', 'description'])
  const image = absoluteUrl(resolvedUrl, extractMetaContent(html, ['og:image', 'twitter:image']))
  const favicon = absoluteUrl(resolvedUrl, extractLinkHref(html, ['icon', 'shortcut icon'])) ||
    absoluteUrl(resolvedUrl, '/favicon.ico')
  const iframeUrl = youtubeEmbedUrl(resolvedUrl)

  return {
    urlPreviewUrl: resolvedUrl,
    urlPreviewTitle: title,
    urlPreviewDescription: description,
    urlPreviewImage: image,
    urlPreviewFavicon: favicon,
    urlPreviewEmbedHtml: '',
    urlPreviewIframeUrl: iframeUrl
  }
}

const saveCurrentUser = (req, patch) => {
  const nextUser = {
    ...req.user,
    ...patch,
    apiKey: req.user.apiKey,
    email: req.user.email,
    id: req.user.id,
    isUpgraded: true
  }
  req.user = saveUser(nextUser)
  return req.user
}

const aggregateUserTags = (user) => {
  if (Array.isArray(user.tags) && user.tags.length) {
    return user.tags
  }
  return []
}

const findCardAcrossSpaces = (cardId) => {
  for (const space of listActiveSpaces()) {
    const card = (space.cards || []).find(item => item.id === cardId)
    if (card) {
      return { space, card }
    }
  }
  return null
}

app.get('/api', (req, res) => {
  res.json({ ok: true, databasePath: getDatabasePath() })
})

app.get('/api/meta/date', (req, res) => {
  res.json({ date: new Date().toISOString() })
})

app.get('/api/meta/changelog', (req, res) => {
  res.json([])
})

app.get('/api/meta/emojis', (req, res) => {
  res.json(emojiPayload)
})

app.post('/api/session-token/create', (req, res) => {
  res.json({ ok: true })
})

app.post('/api/user/sign-up', (req, res) => {
  res.status(403).json({ message: 'Sign up is disabled in self-host mode' })
})

app.post('/api/user/sign-in', (req, res) => {
  const email = String(req.body.email || '').toLowerCase()
  const password = String(req.body.password || '')
  const user = getAdminUserByEmail(email)
  if (!user || !verifyPassword(email, password)) {
    return res.status(401).json({ message: 'Incorrect email or password' })
  }
  return res.json(user)
})

app.post('/api/user/reset-password', (req, res) => {
  res.status(405).json({ message: 'Password reset email is disabled in self-host mode' })
})

app.patch('/api/user/update-password', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Password update via email flow is disabled in self-host mode' })
})

app.patch('/api/user/update-email', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Email updates are disabled in self-host mode' })
})

app.get('/api/user', requireAuth, (req, res) => {
  res.json(getAdminUserByApiKey(req.user.apiKey))
})

app.get('/api/user/favorite-spaces', requireAuth, (req, res) => {
  res.json(req.user.favoriteSpaces || [])
})

app.get('/api/user/favorite-users', requireAuth, (req, res) => {
  res.json(req.user.favoriteUsers || [])
})

app.get('/api/user/favorite-colors', requireAuth, (req, res) => {
  res.json(req.user.favoriteColors || [])
})

app.get('/api/user/hidden-spaces', requireAuth, (req, res) => {
  res.json(req.user.hiddenSpaces || [])
})

app.get('/api/user/tags', requireAuth, (req, res) => {
  res.json(aggregateUserTags(req.user))
})

app.get('/api/user/spaces', requireAuth, (req, res) => {
  ensureInboxSpace()
  res.json(listActiveSpaces())
})

app.get('/api/user/template-spaces', requireAuth, (req, res) => {
  res.json(listActiveSpaces().filter(space => space.isTemplate))
})

app.get('/api/user/group-spaces', requireAuth, (req, res) => {
  res.json([])
})

app.get('/api/user/removed-spaces', requireAuth, (req, res) => {
  res.json(listRemovedSpaces())
})

app.get('/api/user/inbox-space', requireAuth, (req, res) => {
  const inbox = ensureInboxSpace()
  res.json(inbox || null)
})

app.get('/api/user/spaces-notification-unsubscribed', requireAuth, (req, res) => {
  res.json([])
})

app.get('/api/user/groups-notification-unsubscribed', requireAuth, (req, res) => {
  res.json([])
})

app.get('/api/user/groups', requireAuth, (req, res) => {
  res.json([])
})

app.get('/api/user/public/:id', (req, res) => {
  const spaces = listActiveSpaces().filter(space => space.userId === adminUser.id && space.privacy !== 'private')
  res.json({ ...publicUser(adminUser), spaces })
})

app.get('/api/user/public/multiple', (req, res) => {
  const userIds = String(req.query.userIds || '').split(',').filter(Boolean)
  const users = userIds.length ? userIds.map(() => publicUser(adminUser)) : []
  res.json(users)
})

app.get('/api/user/public/explore-spaces/:id', (req, res) => {
  res.json([])
})

app.get('/api/user/favorites', requireAuth, (req, res) => {
  res.json({
    favoriteSpaces: req.user.favoriteSpaces || [],
    favoriteUsers: req.user.favoriteUsers || [],
    favoriteColors: req.user.favoriteColors || []
  })
})

app.patch('/api/user/favorites', requireAuth, (req, res) => {
  saveCurrentUser(req, req.body || {})
  res.json(req.user)
})

app.get('/api/space/inbox', requireAuth, (req, res) => {
  const inbox = ensureInboxSpace()
  res.json(inbox || null)
})

app.get('/api/space/explore-spaces', (req, res) => {
  res.json([])
})

app.get('/api/space/everyone-spaces', (req, res) => {
  res.json([])
})

app.get('/api/space/live-spaces', (req, res) => {
  res.json([])
})

app.post('/api/space/search-explore-spaces', (req, res) => {
  res.json([])
})

app.get('/api/space/public/multiple', (req, res) => {
  const ids = String(req.query.spaceIds || '').split(',').filter(Boolean)
  const spaces = ids
    .map(id => getSpace(id))
    .filter(space => space && space.privacy !== 'private')
  res.json(spaces)
})

app.post('/api/space/multiple', requireAuth, (req, res) => {
  const spaces = Array.isArray(req.body) ? req.body : []
  const savedSpaces = spaces.map(space => saveSpace({ ...space, userId: req.user.id }))
  res.json(savedSpaces)
})

app.post('/api/space/drawing-image', requireAuth, (req, res) => {
  const { spaceId, dataUrl } = req.body || {}
  const space = getSpace(spaceId)
  if (!space) {
    return res.status(404).json({ message: 'Space not found' })
  }
  const saved = saveSpace({ ...space, drawingImage: dataUrl })
  res.json(saved)
})

app.post('/api/space', requireAuth, (req, res) => {
  const saved = saveSpace({ ...req.body, userId: req.user.id })
  res.json(saved)
})

app.patch('/api/space', requireAuth, (req, res) => {
  const previous = getSpace(req.body.id)
  const saved = saveSpace({ ...previous, ...req.body, userId: req.user.id })
  res.json(saved)
})

app.post('/api/space/preview-image', requireAuth, (req, res) => {
  res.json({ url: null })
})

app.get('/api/space/updated-at/:spaceId', (req, res) => {
  const space = getSpace(req.params.spaceId)
  if (!space || !canViewSpace(req, space)) {
    return res.status(404).json({ message: 'Space not found' })
  }
  res.json({ updatedAt: space.updatedAt || space.editedAt || space.createdAt })
})

app.get('/api/space/:spaceId/favorites', (req, res) => {
  res.json([])
})

app.get('/api/space/:spaceId/history', (req, res) => {
  res.json([])
})

app.get('/api/space/:spaceId/removed-cards', requireAuth, (req, res) => {
  const space = getSpace(req.params.spaceId)
  res.json(space?.removedCards || [])
})

app.get('/api/space/:spaceId/collaborator-key', requireAuth, (req, res) => {
  const space = getSpace(req.params.spaceId)
  res.json({ collaboratorKey: space?.collaboratorKey || null })
})

app.patch('/api/space/collaborator', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Collaborator editing is disabled in self-host mode' })
})

app.delete('/api/space/collaborator', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Collaborator editing is disabled in self-host mode' })
})

app.patch('/api/space/restore/:spaceId', requireAuth, (req, res) => {
  const previous = getSpace(req.params.spaceId)
  if (!previous) {
    return res.status(404).json({ message: 'Space not found' })
  }
  const saved = saveSpace({ ...previous, isRemoved: false })
  res.json(saved)
})

app.post('/api/space/email-invites/:spaceId', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Email invites are disabled in self-host mode' })
})

app.get('/api/space/:spaceId', (req, res) => {
  const space = getSpace(req.params.spaceId)
  if (!space || !canViewSpace(req, space)) {
    return res.status(404).json({ message: 'Space not found' })
  }
  res.json(space)
})

app.post('/api/item/multiple', (req, res) => {
  const { cardIds = [], spaceIds = [] } = req.body || {}
  const cards = []
  const spaces = []

  spaceIds.forEach(spaceId => {
    const space = getSpace(spaceId)
    if (space && canViewSpace(req, space)) {
      spaces.push({
        id: space.id,
        name: space.name,
        privacy: space.privacy,
        previewThumbnailImage: null,
        users: space.users || []
      })
    }
  })

  cardIds.forEach(cardId => {
    const match = findCardAcrossSpaces(cardId)
    if (match && canViewSpace(req, match.space)) {
      cards.push(match.card)
    }
  })

  res.json({ cards, spaces })
})

app.get('/api/card/by-link-to-space/:spaceId', (req, res) => {
  const cards = []
  listActiveSpaces().forEach(space => {
    if (!canViewSpace(req, space)) { return }
    ;(space.cards || []).forEach(card => {
      if (card.linkToSpaceId === req.params.spaceId) {
        cards.push(card)
      }
    })
  })
  res.json(cards)
})

app.post('/api/card/to-inbox', requireAuth, (req, res) => {
  const inbox = ensureInboxSpace()
  const card = {
    ...req.body,
    spaceId: inbox.id,
    userId: req.user.id
  }
  const saved = saveSpace({
    ...inbox,
    cards: [...(inbox.cards || []), card]
  })
  res.json(saved)
})

app.post('/api/card/search', requireAuth, (req, res) => {
  const search = String(req.body.search || '').toLowerCase()
  const cards = []
  listActiveSpaces().forEach(space => {
    ;(space.cards || []).forEach(card => {
      const text = `${card.name || ''} ${card.urlPreviewTitle || ''} ${card.urlPreviewDescription || ''}`.toLowerCase()
      if (search && text.includes(search)) {
        cards.push(card)
      }
    })
  })
  res.json(cards)
})

app.patch('/api/card/update-counter', requireAuth, (req, res) => {
  const { cardId, shouldIncrement, shouldDecrement } = req.body || {}
  const match = findCardAcrossSpaces(cardId)
  if (!match) {
    return res.status(404).json({ message: 'Card not found' })
  }
  const delta = shouldIncrement ? 1 : shouldDecrement ? -1 : 0
  const voteCount = (match.card.voteCount || 0) + delta
  const saved = saveSpace({
    ...match.space,
    cards: match.space.cards.map(card => card.id === cardId ? { ...card, voteCount } : card)
  })
  res.json(saved)
})

app.patch('/api/card/update-url-preview-image', requireAuth, (req, res) => {
  res.json({ ok: true })
})

app.post('/api/operations', requireAuth, (req, res) => {
  const result = applyOperations(req.body, req.user)
  res.json(result)
})

app.post('/api/upload/presigned-post', requireAuth, (req, res) => {
  const { key } = req.body || {}
  res.json({
    url: `${requestOrigin(req)}/api/upload/direct?key=${encodeURIComponent(key)}`,
    fields: {}
  })
})

app.post('/api/upload/presigned-post/multiple', requireAuth, (req, res) => {
  const files = Array.isArray(req.body.files) ? req.body.files : []
  res.json(files.map(file => ({
    url: `${requestOrigin(req)}/api/upload/direct?key=${encodeURIComponent(file.key)}`,
    fields: {}
  })))
})

app.post('/api/upload/direct', requireAuth, upload.single('file'), (req, res) => {
  const key = String(req.query.key || '')
  if (!req.file || !key) {
    return res.status(400).json({ message: 'Missing upload file or key' })
  }
  const [ownerId = '', ...rest] = key.split('/')
  const fileName = rest.join('/') || req.file.originalname
  saveAsset({
    key,
    fileName,
    mimeType: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    data: req.file.buffer,
    ownerId,
    spaceId: req.body.requestSpaceId || null
  })
  res.json({ ok: true, key, url: `${requestOrigin(req)}/uploads/${key}` })
})

app.get('/uploads/{*key}', (req, res) => {
  const pathKey = req.path.replace(/^\/uploads\/+/, '')
  const rawKey = String(req.params.key || '')
  const decodedKey = decodeURIComponent(rawKey)
  const keys = [
    pathKey,
    decodeURIComponent(pathKey),
    rawKey,
    rawKey.replace(/^\/+/, ''),
    decodedKey,
    decodedKey.replace(/^\/+/, ''),
    rawKey.split('/').slice(-2).join('/'),
    decodedKey.split('/').slice(-2).join('/')
  ].filter(Boolean)
  const uniqueKeys = [...new Set(keys)]
  if (!uniqueKeys.length) {
    return res.status(404).send('Not found')
  }
  const asset = uniqueKeys.map(getAssetByKey).find(Boolean)
  if (!asset) {
    return res.status(404).send('Not found')
  }
  res.setHeader('Content-Type', asset.mime_type)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.send(asset.data)
})

app.get('/api/notification', requireAuth, (req, res) => {
  res.json([])
})

app.delete('/api/notification/all', requireAuth, (req, res) => {
  res.json({ ok: true })
})

app.get('/api/space/date-image', (req, res) => {
  res.json({ url: null })
})

app.post('/api/billing/stripe/checkout-url', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Billing is disabled in self-host mode' })
})

app.post('/api/billing/stripe/subscription-url', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Billing is disabled in self-host mode' })
})

app.post('/api/billing/stripe/customer-portal-url', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Billing is disabled in self-host mode' })
})

app.post('/api/billing/stripe/donation-url', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Billing is disabled in self-host mode' })
})

app.post('/api/services/analytics-event', (req, res) => {
  res.json({ ok: true })
})
app.patch('/api/user/update-arena-access-token', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Are.na auth is disabled in self-host mode' })
})

app.post('/api/services/url-preview', requireAuth, async (req, res) => {
  const { url, card } = req.body || {}
  if (!url) {
    return res.status(400).json({ message: 'Missing URL' })
  }

  try {
    const preview = await fetchUrlPreviewMetadata(url)
    res.json({
      id: card?.id,
      ...preview,
      urlPreviewErrorUrl: null,
      shouldUpdateUrlPreview: false
    })
  } catch (error) {
    res.status(422).json({ message: error.message || 'Could not fetch URL preview metadata' })
  }
})

app.post('/api/services/image-search', requireAuth, (req, res) => {
  res.json([])
})

app.post('/api/services/gif-image-search', requireAuth, (req, res) => {
  res.json([])
})

app.get('/api/services/community-backgrounds', requireAuth, (req, res) => {
  res.json([])
})

app.post('/api/services/pdf/:spaceId', requireAuth, (req, res) => {
  res.status(405).json({ message: 'PDF export service is disabled in self-host mode' })
})

app.get('/api/space/download-all', requireAuth, (req, res) => {
  const payload = JSON.stringify(listActiveSpaces(), null, 2)
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', 'attachment; filename="kinopio-spaces.json"')
  res.send(payload)
})

app.get('/api/group/:groupId', requireAuth, (req, res) => {
  res.status(404).json({ message: 'Groups are disabled in self-host mode' })
})

app.get('/api/group/:groupId/public-meta', (req, res) => {
  res.status(404).json({ message: 'Groups are disabled in self-host mode' })
})

app.post('/api/group', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Groups are disabled in self-host mode' })
})

app.post('/api/group/group-user', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Groups are disabled in self-host mode' })
})

app.delete('/api/group/group-user', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Groups are disabled in self-host mode' })
})

app.delete('/api/group', requireAuth, (req, res) => {
  res.status(405).json({ message: 'Groups are disabled in self-host mode' })
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
}

app.get('/{*path}', (req, res) => {
  const appHtml = path.join(distDir, 'app.html')
  const indexHtml = path.join(distDir, 'index.html')
  if (fs.existsSync(appHtml)) {
    return res.sendFile(appHtml)
  }
  if (fs.existsSync(indexHtml)) {
    return res.sendFile(indexHtml)
  }
  res.status(200).send(`<!doctype html><html><body><h1>kinopio-selfhost</h1><p>Build the client with <code>npm run build</code> and then restart the server.</p></body></html>`)
})

const port = Number(process.env.PORT || 3000)
app.listen(port, () => {
  console.log(`kinopio-selfhost listening on http://0.0.0.0:${port}`)
})


