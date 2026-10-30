import i18n from './index'

// React 组件订阅 studio 命名空间；store 和第三方图片控件复用同一翻译实例
export const t = i18n.getFixedT(null, 'studio')

export function translateMessage(message: string) {
  if (i18n.exists(message, { ns: 'studio' })) return t(message)
  if (i18n.resolvedLanguage === 'en-US' && /[\u4e00-\u9fff]/.test(message))
    return t('无法完成请求，请重试或重新登录')
  return message
}
