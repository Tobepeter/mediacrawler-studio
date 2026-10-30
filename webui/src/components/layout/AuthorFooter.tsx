import { useTranslation } from 'react-i18next'
import { Sparkles, Heart } from 'lucide-react'

export function AuthorFooter() {
  const { t } = useTranslation('license')

  return (
    <footer className='glass-panel border-cyber-border-subtle h-24 flex-shrink-0 border-t'>
      <div className='flex h-full items-center justify-center gap-6 px-6'>
        {/* Author Avatar */}
        <div className='border-cyber-neon-cyan/60 shadow-glow-cyan-sm h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border-2'>
          <img
            src='/logos/my_logo.png'
            alt='程序员阿江-Relakkes'
            className='h-full w-full object-cover'
          />
        </div>

        {/* Author Info */}
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <span className='text-cyber-text-primary text-lg font-bold'>
              {t('author.name')}
            </span>
            <Sparkles className='text-cyber-neon-cyan h-5 w-5 animate-pulse' />
          </div>
          <span className='text-cyber-text-muted hidden text-sm sm:inline'>
            {t('author.description')}
          </span>
          <div className='text-cyber-neon-cyan flex items-center gap-2'>
            <Heart className='h-4 w-4 animate-pulse fill-current' />
            <span className='text-sm font-medium'>{t('author.slogan')}</span>
          </div>
        </div>

        {/* Social Links */}
        <div className='flex items-center gap-3'>
          <a
            href='https://github.com/NanmiCoder'
            target='_blank'
            rel='noopener noreferrer'
            className='border-cyber-border-subtle hover:border-cyber-neon-cyan hover:shadow-glow-cyan-sm bg-cyber-bg-tertiary flex h-11 w-11 items-center justify-center rounded-lg border transition-all hover:scale-110'
            title='GitHub'
          >
            <img
              src='/logos/github.png'
              alt='GitHub'
              className='h-6 w-6 object-contain'
            />
          </a>
          <a
            href='https://space.bilibili.com/434377496'
            target='_blank'
            rel='noopener noreferrer'
            className='border-cyber-border-subtle bg-cyber-bg-tertiary flex h-11 w-11 items-center justify-center rounded-lg border transition-all hover:scale-110 hover:border-pink-400 hover:shadow-[0_0_10px_rgba(251,113,133,0.4)]'
            title='哔哩哔哩'
          >
            <img
              src='/logos/bilibili_logo.png'
              alt='Bilibili'
              className='h-6 w-6 object-contain'
            />
          </a>
          <a
            href='https://www.xiaohongshu.com/user/profile/5f58bd990000000001003753'
            target='_blank'
            rel='noopener noreferrer'
            className='border-cyber-border-subtle bg-cyber-bg-tertiary flex h-11 w-11 items-center justify-center rounded-lg border transition-all hover:scale-110 hover:border-red-400 hover:shadow-[0_0_10px_rgba(248,113,113,0.4)]'
            title='小红书'
          >
            <img
              src='/logos/xiaohongshu_logo.png'
              alt='小红书'
              className='h-6 w-6 object-contain'
            />
          </a>
          <a
            href='https://www.douyin.com/user/MS4wLjABAAAATJPY7LAlaa5X-c8uNdWkvz0jUGgpw4eeXIwu_8BhvqE'
            target='_blank'
            rel='noopener noreferrer'
            className='border-cyber-border-subtle hover:border-cyber-text-primary bg-cyber-bg-tertiary flex h-11 w-11 items-center justify-center rounded-lg border transition-all hover:scale-110 hover:shadow-[0_0_10px_rgba(255,255,255,0.3)]'
            title='抖音'
          >
            <img
              src='/logos/douyin.png'
              alt='抖音'
              className='h-6 w-6 object-contain'
            />
          </a>
        </div>
      </div>
    </footer>
  )
}
