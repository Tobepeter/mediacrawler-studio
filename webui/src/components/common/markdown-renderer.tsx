import type { ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { t } from '@/i18n/studio'

function Link({ href = '', children }: ComponentProps<'a'>) {
  return (
    <a
      href={href}
      onClick={(event) => {
        // 不在应用窗口里跳转，交给系统浏览器
        event.preventDefault()
        void window.studio
          ?.openSource(href)
          .catch(() => toast.error(t('无法打开来源链接')))
      }}
    >
      {children}
    </a>
  )
}

function Table(props: ComponentProps<'table'>) {
  return (
    <div className='overflow-x-auto'>
      <table {...props} className='my-0' />
    </div>
  )
}

function Image({ src, alt = '' }: ComponentProps<'img'>) {
  return (
    <img
      src={src}
      alt={alt}
      className='mx-auto max-w-full rounded-md'
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
    />
  )
}

// 内容来自平台，不开启原始 HTML；react-markdown 默认也会过滤危险链接
const components = { a: Link, table: Table, img: Image }

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className='prose prose-sm max-w-none break-words leading-relaxed'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
