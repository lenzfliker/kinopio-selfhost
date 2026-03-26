const env = import.meta.env

const currentOrigin = () => {
  if (env.VITE_PUBLIC_APP_ORIGIN) {
    return env.VITE_PUBLIC_APP_ORIGIN
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost:3000'
}

export default {
  spaceZoom: {
    max: 100,
    min: 20
  },
  spaceBetweenCards: 12,
  cardCharacterLimit: 4000,
  defaultCardWidth: 58,
  defaultCardHeight: 70,
  minItemXY: 70,
  minLineY: 90,
  minLineYOutdent: 175,
  minListWidth: 200,
  normalCardWrapWidth: 200,
  wideCardWrapWidth: 390,
  minCardIframeWidth: 310,
  freeCardsCreatedLimit: 100,
  freeUploadSizeLimit: 5,
  upgradedUploadSizeLimit: 256,
  emptyCard () {
    return { width: this.defaultCardWidth, height: 32 }
  },
  defaultDialogWidth: 250,
  minBoxSize: 70,
  defaultBoxWidth: 224,
  defaultBoxHeight: 105,
  itemSnapGuideWaitingDuration: 200,
  maxInviteEmailsAllowedToSend: 15,
  defaultConnectionPathCurveControlPoint: 'q90,40',
  straightLineConnectionPathControlPoint: 'q00,00',
  requestTimeout: 40000,
  rootUserId: 'selfhost-admin',
  sidebarWidth: 250,
  systemCommands: env.VITE_SELFHOST !== 'false'
    ? { newSpace: 'New Space', templates: 'Templates' }
    : { newSpace: 'New Space', templates: 'Templates', apps: 'Apps and Extensions' },
  isSecureAppContextIOS: navigator.isSecureAppContextIOS,
  isSecureAppContext: navigator.isSecureAppContext,
  isSelfHosted () {
    return env.VITE_SELFHOST !== 'false'
  },
  cdnHost: `${currentOrigin()}/uploads`,
  imgproxyHost: 'https://img.kinopio.club',
  defaultSpaceBackground: `${currentOrigin()}/logo.png`,
  moderatorUserId: 'selfhost-admin',
  uploadPlaceholder: '[uploading]',
  itemTypesWithPositions: ['boxes', 'cards', 'lists', 'lines'],
  nameDateFormat: 'MMMM D, YYYY',
  isStaticPrerenderingPage: env.SSR,
  lineInfoOffset: 11,
  listPadding: 8,
  listInfoHeight: 34,
  listEmptyHeight: 56,
  itemSnapOpacity: 0.5,
  edgeThreshold: 30,
  itemTypes: ['cards', 'connections', 'connectionTypes', 'boxes', 'lists', 'lines', 'drawingStrokes'],
  isDevelopment () {
    return env.MODE === 'development'
  },
  kinopioDomain () {
    return currentOrigin()
  },
  apiHost () {
    if (env.VITE_API_HOST) {
      return env.VITE_API_HOST
    }
    if (this.isDevelopment()) {
      return 'http://localhost:3000/api'
    }
    return `${currentOrigin()}/api`
  },
  websocketHost () {
    return ''
  },
  helperServerHost () {
    return this.apiHost()
  },
  userPrefersReducedMotion () {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    return Boolean(query.matches)
  },
  drawingBrushSizeDiameter: {
    xs: 3,
    s: 10,
    m: 20,
    l: 40
  },
  roadmapSpaceId () {
    return 'selfhost-roadmap'
  },
  changelogSpaceId () {
    return 'selfhost-changelog'
  },
  prices: {
    standard: {
      mo: {
        price: 8,
        priceId: 'disabled'
      },
      yr: {
        price: 80,
        priceId: 'disabled'
      },
      life: {
        price: 250,
        priceId: 'disabled'
      }
    },
    education: {
      mo: {
        price: 4,
        priceId: 'disabled'
      },
      yr: {
        price: 40,
        priceId: 'disabled'
      }
    },
    apple: {
      mo: {
        price: 9,
        priceId: 'disabled'
      },
      yr: {
        price: 90,
        priceId: 'disabled'
      }
    }
  },
  price (period, isStudentDiscount) {
    if (period === 'month') {
      return this.monthlyPrice(isStudentDiscount)
    } else if (period === 'year') {
      return this.yearlyPrice(isStudentDiscount)
    } else if (period === 'life') {
      return this.lifetimePrice()
    }
  },
  monthlyPrice (isStudentDiscount) {
    if (isStudentDiscount) {
      return this.monthlyStudentPrice()
    }
    return this.monthlyStandardPrice()
  },
  monthlyStudentPrice () {
    return {
      amount: this.prices.education.mo.price,
      period: 'month',
      stripePriceId: this.prices.education.mo.priceId
    }
  },
  monthlyStandardPrice () {
    return {
      amount: this.prices.standard.mo.price,
      period: 'month',
      stripePriceId: this.prices.standard.mo.priceId,
      applePriceId: this.prices.apple.mo.priceId
    }
  },
  yearlyPrice (isStudentDiscount) {
    if (isStudentDiscount) {
      return this.yearlyStudentPrice()
    }
    return this.yearlyStandardPrice()
  },
  yearlyStandardPrice () {
    return {
      amount: this.prices.standard.yr.price,
      period: 'year',
      stripePriceId: this.prices.standard.yr.priceId,
      applePriceId: this.prices.apple.yr.priceId
    }
  },
  yearlyStudentPrice () {
    return {
      amount: this.prices.education.yr.price,
      period: 'year',
      stripePriceId: this.prices.education.yr.priceId
    }
  },
  lifetimePrice () {
    return {
      amount: this.prices.standard.life.price,
      period: 'life',
      stripePriceId: this.prices.standard.life.priceId
    }
  }
}
