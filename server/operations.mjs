import { getSpace, saveSpace, deleteSpace, saveUser, listSpaces } from './db.mjs'

const clone = (value) => JSON.parse(JSON.stringify(value))
const ensureArray = (value) => Array.isArray(value) ? value : []

const upsertById = (items, update, merge = true) => {
  const nextItems = ensureArray(items).map(item => ({ ...item }))
  const index = nextItems.findIndex(item => item.id === update.id)
  if (index === -1) {
    nextItems.push(update)
  } else {
    nextItems[index] = merge ? { ...nextItems[index], ...update } : update
  }
  return nextItems
}

const removeById = (items, id) => ensureArray(items).filter(item => item?.id !== id)

const mutateSpace = (spaceId, mutate) => {
  const space = getSpace(spaceId)
  if (!space) { return null }
  const draft = clone(space)
  mutate(draft)
  draft.updatedAt = new Date().toISOString()
  return saveSpace(draft)
}

const favoriteToggle = (items, value, key = 'id') => {
  const nextItems = ensureArray(items).filter(item => item?.[key] !== value?.[key])
  if (value) {
    nextItems.push(value)
  }
  return nextItems
}

const updateUserField = (user, patch) => {
  const nextUser = { ...clone(user), ...patch }
  nextUser.isUpgraded = true
  const savedUser = saveUser(nextUser)
  Object.assign(user, savedUser)
  return savedUser
}

const findInboxSpace = () => listSpaces().find(space => space.name === 'Inbox')

const handlers = {
  createSpace ({ body }) {
    return saveSpace(body)
  },
  updateSpace ({ body, spaceId }) {
    const targetId = body.id || body.spaceId || spaceId
    return mutateSpace(targetId, (space) => {
      Object.assign(space, body)
    })
  },
  removeSpace ({ body, spaceId }, user) {
    const targetId = body.id || body.spaceId || spaceId
    return mutateSpace(targetId, (space) => {
      space.isRemoved = true
      space.removedByUserId = user.id
      space.removeDate = Date.now()
    })
  },
  deleteSpace ({ body, spaceId }) {
    deleteSpace(body.id || body.spaceId || spaceId)
    return true
  },
  deleteAllRemovedSpaces () {
    listSpaces({ includeRemoved: true }).forEach(space => {
      if (space.isRemoved) {
        deleteSpace(space.id)
      }
    })
    return true
  },
  restoreRemovedSpace ({ body, spaceId }) {
    const targetId = body.id || body.spaceId || spaceId
    return mutateSpace(targetId, (space) => {
      space.isRemoved = false
      delete space.removeDate
      delete space.removedByUserId
    })
  },
  createCard ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.cards = upsertById(space.cards, body, false)
    })
  },
  updateCard ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.cards = upsertById(space.cards, body)
    })
  },
  removeCard ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.cards = removeById(space.cards, body.id)
      space.tags = ensureArray(space.tags).filter(tag => tag.cardId !== body.id)
    })
  },
  deleteCard ({ body, spaceId }) {
    return handlers.removeCard({ body, spaceId })
  },
  restoreRemovedCard ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.cards = upsertById(space.cards, { ...body, isRemoved: false })
    })
  },
  deleteAllRemovedCards ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.cards = ensureArray(space.cards).filter(card => !card.isRemoved)
    })
  },
  createCardInInbox ({ body }, user) {
    const inbox = findInboxSpace()
    if (!inbox) { return null }
    return mutateSpace(inbox.id, (space) => {
      const card = {
        ...body,
        userId: user.id,
        spaceId: inbox.id
      }
      space.cards = upsertById(space.cards, card, false)
    })
  },
  createBox ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.boxes = upsertById(space.boxes, body, false)
    })
  },
  updateBox ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.boxes = upsertById(space.boxes, body)
    })
  },
  removeBox ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.boxes = removeById(space.boxes, body.id)
      space.connections = ensureArray(space.connections).filter(connection => connection.startItemId !== body.id && connection.endItemId !== body.id)
    })
  },
  createConnection ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.connections = upsertById(space.connections, body, false)
    })
  },
  updateConnection ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.connections = upsertById(space.connections, body)
    })
  },
  removeConnection ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.connections = removeById(space.connections, body.id)
    })
  },
  createConnectionType ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.connectionTypes = upsertById(space.connectionTypes, body, false)
    })
  },
  updateConnectionType ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.connectionTypes = upsertById(space.connectionTypes, body)
    })
  },
  removeConnectionType ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.connectionTypes = removeById(space.connectionTypes, body.id)
      const validTypeIds = new Set(space.connectionTypes.map(type => type.id))
      space.connections = ensureArray(space.connections).filter(connection => validTypeIds.has(connection.connectionTypeId))
    })
  },
  createList ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.lists = upsertById(space.lists, body, false)
    })
  },
  updateList ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.lists = upsertById(space.lists, body)
    })
  },
  removeList ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.lists = removeById(space.lists, body.id)
      space.cards = ensureArray(space.cards).map(card => {
        if (card.listId !== body.id) { return card }
        return {
          ...card,
          listId: null,
          listPositionIndex: null
        }
      })
    })
  },
  createLine ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.lines = upsertById(space.lines, body, false)
    })
  },
  updateLine ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.lines = upsertById(space.lines, body)
    })
  },
  removeLine ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.lines = removeById(space.lines, body.id)
    })
  },
  createDrawingStroke ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.drawingStrokes = upsertById(space.drawingStrokes, body, false)
    })
  },
  removeDrawingStroke ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.drawingStrokes = removeById(space.drawingStrokes, body.id)
    })
  },
  clearDrawing ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.drawingStrokes = []
      space.drawingImage = null
    })
  },
  updateTags ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      const existing = new Map(ensureArray(space.tags).map(tag => [tag.id, tag]))
      ensureArray(body.tags).forEach(tag => existing.set(tag.id, tag))
      space.tags = Array.from(existing.values())
    })
  },
  removeTag ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.tags = removeById(space.tags, body.id)
    })
  },
  removeTagsByName ({ body, spaceId }) {
    return mutateSpace(body.spaceId || spaceId, (space) => {
      space.tags = ensureArray(space.tags).filter(tag => tag.name !== body.name)
    })
  },
  updateTagColorByName ({ body, spaceId }) {
    return mutateSpace(body.tag?.spaceId || body.spaceId || spaceId, (space) => {
      space.tags = ensureArray(space.tags).map(tag => {
        if (tag.name !== body.tag.name) { return tag }
        return {
          ...tag,
          color: body.tag.color
        }
      })
    })
  },
  updateUrlPreviewImage () {
    return true
  },
  updateUser ({ body }, user) {
    return updateUserField(user, body)
  },
  updateFavoriteSpace ({ body }, user) {
    const favoriteSpaces = body.value
      ? favoriteToggle(user.favoriteSpaces, { id: body.spaceId })
      : favoriteToggle(user.favoriteSpaces, null).filter(item => item.id !== body.spaceId)
    return updateUserField(user, { favoriteSpaces })
  },
  updateFavoriteUser ({ body }, user) {
    const favoriteUsers = body.value
      ? favoriteToggle(user.favoriteUsers, { id: body.favoriteUserId })
      : favoriteToggle(user.favoriteUsers, null).filter(item => item.id !== body.favoriteUserId)
    return updateUserField(user, { favoriteUsers })
  },
  updateFavoriteColor ({ body }, user) {
    const favoriteColors = body.value
      ? Array.from(new Set([...(user.favoriteColors || []), body.color]))
      : ensureArray(user.favoriteColors).filter(color => color !== body.color)
    return updateUserField(user, { favoriteColors })
  },
  updateUserCardsCreatedCount ({ body }, user) {
    return updateUserField(user, { cardsCreatedCount: (user.cardsCreatedCount || 0) + (body.delta || 0) })
  },
  updateUserCardsCreatedCountRaw ({ body }, user) {
    return updateUserField(user, { cardsCreatedCountRaw: (user.cardsCreatedCountRaw || 0) + (body.delta || 0) })
  },
  createUserNotification () {
    return true
  },
  removeUserNotification () {
    return true
  },
  addCollaboratorToSpaces () {
    return true
  },
  updateGroup () {
    return true
  },
  updateGroupUser () {
    return true
  }
}

export const applyOperations = (operations, user) => {
  const results = []
  const errors = []

  ensureArray(operations).forEach(operation => {
    const handler = handlers[operation.name]
    if (!handler) {
      errors.push({ name: operation.name, status: 400, message: 'Unsupported operation in self-host mode' })
      return
    }
    try {
      const result = handler(operation, user)
      results.push({ name: operation.name, result })
    } catch (error) {
      errors.push({
        name: operation.name,
        status: 500,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  return { operations: results, errors }
}
