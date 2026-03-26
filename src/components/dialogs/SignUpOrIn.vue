<script setup>
import { reactive, watch, ref, nextTick, computed } from 'vue'

import { useUserStore } from '@/stores/useUserStore'
import { useSpaceStore } from '@/stores/useSpaceStore'
import { useApiStore } from '@/stores/useApiStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useGlobalStore } from '@/stores/useGlobalStore'

import utils from '@/utils.js'
import Loader from '@/components/Loader.vue'
import cache from '@/cache.js'

import inboxSpace from '@/data/inbox.json'
import helloSpace from '@/data/hello.json'

const globalStore = useGlobalStore()
const userStore = useUserStore()
const spaceStore = useSpaceStore()
const apiStore = useApiStore()
const themeStore = useThemeStore()

let shouldLoadLastSpace
const emailElement = ref(null)

const emit = defineEmits(['loading'])
const props = defineProps({
  visible: Boolean
})

const state = reactive({
  email: '',
  password: '',
  error: {
    signInCredentials: false,
    unknownServerError: false
  },
  loading: false
})

watch(() => props.visible, async (value) => {
  if (value) {
    clearErrors()
    globalStore.shouldExplicitlyHideFooter = true
    await nextTick()
    emailElement.value?.focus()
  } else {
    globalStore.shouldExplicitlyHideFooter = false
  }
})

watch(() => state.loading, (value) => {
  emit('loading', value)
})

const groupToJoinOnLoad = computed(() => globalStore.groupToJoinOnLoad)

const clearErrors = () => {
  state.error.signInCredentials = false
  state.error.unknownServerError = false
}

const isSuccess = (response) => {
  return [200, 201, 202, 204].includes(response.status)
}

const handleError = (response) => {
  state.loading = false
  state.error.signInCredentials = response?.status === 401
  state.error.unknownServerError = response?.status !== 401
}

const backupLocalSpaces = async () => {
  const spaces = await cache.getAllSpaces()
  await cache.saveLocal('spacesBackup', spaces)
}

const migrationSpacesConnections = async () => {
  const spaces = await cache.getAllSpaces()
  const newSpaces = spaces.map(space => {
    space.connections = utils.migrationConnections(space.connections)
    return space
  })
  for (const space of newSpaces) {
    await cache.saveSpace(space)
  }
}

const updateLocalSpacesUser = async () => {
  const user = userStore.getUserPublicMeta
  const spaces = await cache.getAllSpaces()
  const newSpaces = utils.updateSpacesUser(user, spaces)
  for (const space of newSpaces) {
    await cache.saveSpace(space)
  }
}

const removeUneditedSpace = async (spaceName) => {
  const currentSpace = await cache.getSpaceByName(spaceName)
  if (!currentSpace) { return }
  let space
  if (spaceName === 'Hello Kinopio') {
    space = helloSpace
  } else if (spaceName === 'Inbox') {
    space = inboxSpace
  }
  const cardNames = space.cards.map(card => card.name)
  let spaceIsEdited = false
  const cards = currentSpace?.cards || []
  cards.forEach(card => {
    if (!card.name.trim()) { return }
    if (!cardNames.includes(card.name)) {
      spaceIsEdited = true
    }
  })
  if (!spaceIsEdited) {
    await cache.deleteSpace(currentSpace)
    shouldLoadLastSpace = true
  }
}

const notifySignedIn = () => {
  state.loading = false
  globalStore.closeAllDialogs()
  globalStore.removeNotificationByMessage('Signing In…')
  globalStore.addNotification({ message: 'Signed In', type: 'success' })
  globalStore.currentUserIsInvitedButCannotEditCurrentSpace = false
}

const signIn = async (event) => {
  if (state.loading) { return }
  const email = event.target[0].value.toLowerCase()
  const password = event.target[1].value
  state.loading = true
  const response = await apiStore.signIn({ email, password })
  const result = await response.json()
  if (!isSuccess(response)) {
    return handleError(result)
  }

  globalStore.isLoadingSpace = true
  globalStore.addNotification({ message: 'Signing In…' })
  userStore.initializeUserState(result)
  await backupLocalSpaces()
  await removeUneditedSpace('Hello Kinopio')
  await removeUneditedSpace('Inbox')
  await migrationSpacesConnections()
  await updateLocalSpacesUser()
  await apiStore.createSpaces()
  const spaces = await apiStore.getUserSpaces()
  if (spaces?.length) {
    await cache.addSpaces(spaces)
  }
  notifySignedIn()
  userStore.restoreUserAssociatedData()
  globalStore.triggerUpdateNotifications()
  themeStore.restoreTheme()
  if (shouldLoadLastSpace) {
    await spaceStore.loadLastSpace()
    globalStore.triggerUpdateWindowHistory()
  }
  globalStore.isLoadingSpace = false
}
</script>

<template lang="pug">
dialog.narrow.sign-up-or-in(v-if="props.visible" :open="props.visible")
  section.title-section
    p Self-Hosted Sign In
  section
    p Sign in with the admin email and password configured on the server.
    p(v-if="groupToJoinOnLoad")
      span.badge.info Groups are disabled in self-host mode.
    form(@submit.prevent="signIn")
      input.email(ref="emailElement" name="email" type="email" autocomplete="email" placeholder="Email" required v-model="state.email" @input="clearErrors")
      input(type="password" name="password" placeholder="Password" required v-model="state.password" @input="clearErrors")
      .badge.danger(v-if="state.error.unknownServerError") Could not sign in. Check the server configuration and try again.
      .badge.danger(v-if="state.error.signInCredentials") Incorrect email or password
      button(name="signIn" type="submit" :class="{active : state.loading}" tabindex="0")
        span Sign In
        Loader(:visible="state.loading")
</template>

<style lang="stylus">
dialog.sign-up-or-in
  left initial
  right 8px
  overflow auto
  p,
  .badge
    margin-bottom 10px
  button
    span
      font-weight normal
</style>
