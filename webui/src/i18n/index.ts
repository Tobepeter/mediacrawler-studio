import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhStudio from './locales/zh-CN/studio.json'
import enStudio from './locales/en-US/studio.json'

const resources = {
  'zh-CN': {
    studio: zhStudio,
  },
  'en-US': {
    studio: enStudio,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en-US'],
    initImmediate: false,
    defaultNS: 'studio',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'studio-language',
    },
  })

const updateLang = () => {
  document.documentElement.lang = i18n.resolvedLanguage || 'zh-CN'
}
updateLang()
i18n.on('languageChanged', updateLang)

export default i18n
