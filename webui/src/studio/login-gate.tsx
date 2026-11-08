import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import { Loader2, LogOut, ScanLine, Square, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { IconButton } from '@/components/common/icon-button'
import { platformBusy, useStudio } from './store'
import { useStudioRoute } from './route'

// 仅展示账号和处理用户操作；启动会话检查由主进程管理
export function LoginGate() {
  const { t } = useTranslation('studio')

  const collecting = useStudioRoute() === 'collect'
  const {
    platform,
    accounts,
    profiles,
    tasks,
    requests,
    pending: clearing,
    ready,
    start,
  } = useStudio()
  const account = accounts[platform] || 'unknown'
  const task = tasks[platform]
  const pending = clearing || !!requests[platform]
  const blocked = useStudio(platformBusy)
  const busy =
    blocked && task?.platform === platform && task.action === 'connect'
  const auth = task?.platform === platform && task.status === 'auth'
  const stopping = task?.platform === platform && task.status === 'stopping'
  const needsFocus = useRef(false)
  const profile = profiles[platform]
  const loggingOut = requests[platform] === 'logout'

  useEffect(() => {
    if (account !== 'connected') {
      needsFocus.current = true
    } else if (collecting && !blocked && needsFocus.current) {
      if (!document.querySelector('[role=dialog]'))
        document.getElementById('query')?.focus()
      needsFocus.current = false
    }
  }, [collecting, account, blocked])

  const login = async () => {
    try {
      if (auth) await window.studio?.showLogin(undefined, platform)
      else await start('connect')
    } catch {
      toast.error(t('打开失败，请重试'))
    }
  }
  const cancel = async () => {
    try {
      await useStudio.getState().cancelLogin()
    } catch {
      toast.error(t('停止失败，请重试'))
    }
  }

  const logout = async () => {
    const state = useStudio.getState()
    if (!window.studio || platformBusy(state, platform)) return
    // 主动退出后不立即自动弹扫码，用户可点击重新登录
    state.setRequest(platform, 'logout')
    state.patch({
      attempted: { ...state.attempted, [platform]: true },
    })
    try {
      const result = await window.studio.logout(platform)
      if (result.localOnly)
        toast.warning(t('仅清除了本地登录态，未能确认平台登出'))
      else toast.success(t('已退出登录'))
    } catch {
      toast.error(t('退出失败，请重试'))
    } finally {
      useStudio.getState().setRequest(platform)
    }
  }

  if (account === 'connected')
    return (
      <div
        className='flex min-h-10 items-center gap-2'
        aria-label={t('已登录：{{name}}', {
          name: profile?.nickname || t('当前账号'),
        })}
      >
        <Avatar>
          <AvatarImage
            src={profile?.avatar || undefined}
            alt=''
            className='object-cover'
            referrerPolicy='no-referrer'
          />
          <AvatarFallback>
            <UserRound className='size-4' aria-hidden='true' />
          </AvatarFallback>
        </Avatar>
        <span className='max-w-32 truncate'>
          {profile?.nickname || t('已登录')}
        </span>
        <IconButton
          label={t('退出登录')}
          disabled={!window.studio || blocked}
          onClick={() => void logout()}
          aria-busy={loggingOut}
        >
          {loggingOut ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <LogOut />
          )}
        </IconButton>
      </div>
    )

  const label = !window.studio
    ? t('桌面端登录')
    : stopping
      ? t('正在停止')
      : auth
        ? t('扫码登录')
        : busy || !ready
          ? t('连接中')
          : t('扫码登录')
  return (
    <div
      className='flex min-h-10 items-center gap-1'
      role='group'
      aria-label={t('账号')}
    >
      <Button
        id='login-gate-label'
        variant='ghost'
        disabled={!window.studio || !ready || (blocked && !auth) || stopping}
        aria-busy={busy && !auth}
        onClick={() => void login()}
      >
        {busy && !auth ? (
          <Loader2 className='animate-spin motion-reduce:animate-none' />
        ) : (
          <ScanLine />
        )}
        {label}
      </Button>
      {(busy || auth) && (
        <IconButton
          label={t('取消登录')}
          disabled={pending || stopping}
          onClick={() => void cancel()}
        >
          <Square />
        </IconButton>
      )}
    </div>
  )
}
