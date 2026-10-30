import type { ContentItem } from './types'

// DEV：显式查看示例，不模拟登录或采集成功
export const previewItems: ContentItem[] = [
  {
    id: 'demo-1',
    platform: 'bili',
    title: '从一个小想法开始，做自己的独立产品',
    text: '把复杂的问题拆小，从身边真实的需求出发。记录一次从想法、原型到第一个用户的过程。\n\n先做能用的一小步，再慢慢把体验打磨好。',
    author: '创作者 A',
    url: '',
    images: [],
    likes: '128',
    collectedAt: '',
  },
  {
    id: 'demo-2',
    platform: 'xhs',
    title: '我的灵感收集习惯：少一点，留得久一点',
    text: '不必收集所有东西，只留下让自己想动手的那一部分。\n\n一个问题、一段笔记，再加上最初的来源，就足够让灵感在未来重新生长。',
    author: '创作者 B',
    url: '',
    images: [],
    likes: '86',
    collectedAt: '',
  },
  {
    id: 'demo-3',
    platform: 'dy',
    title: '给工作台做一次减法',
    text: '关掉不必要的通知，留下当前正在做的事。舒服的工作环境不一定需要很多工具，而是让常用的东西触手可及。',
    author: '创作者 C',
    url: '',
    images: [],
    likes: '256',
    collectedAt: '',
  },
]
