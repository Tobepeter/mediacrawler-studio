import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { Loader2, LogOut, ScanLine, Square, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { StableLabel } from '@/components/common/stable-label'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { IconButton } from '@/components/common/icon-button'
import { platformBusy, useStudio } from './store'
import { useStudioRoute } from './route'

// 名字占头像和退出按钮之间的固定空间，超长省略，只有被截断时悬停才显示全名
function AccountName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const clipped = () => {
    const node = ref.current
    return !!node && node.scrollWidth > node.clientWidth
  }
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && clipped())}>
      <TooltipTrigger asChild>
        <span ref={ref} className='min-w-0 flex-1 truncate'>
          {name}
        </span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}

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
        className='flex min-h-10 w-full items-center gap-2'
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
        {/* 换平台时名字变了，提示的开合状态要重新开始，不沿用上一个账号的 */}
        <AccountName
          key={profile?.nickname || ''}
          name={profile?.nickname || t('已登录')}
        />
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
        <StableLabel
          labels={[t('桌面端登录'), t('正在停止'), t('扫码登录'), t('连接中')]}
          current={label}
        />
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
