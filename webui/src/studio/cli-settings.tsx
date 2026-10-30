import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, Terminal, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function CliSettings() {
  const { t } = useTranslation('studio')
  const client = useQueryClient()
  const { data: state } = useQuery({
    queryKey: ['studio', 'cli-status'],
    queryFn: () => window.studio!.cliStatus(),
    enabled: !!window.studio,
  })
  const { mutate, isPending: pending } = useMutation({
    mutationKey: ['studio', 'cli-install'],
    mutationFn: (action: 'install' | 'remove') =>
      window.studio!.cliInstall(action),
    onSuccess: (result, action) => {
      if (!result.ok) {
        const reasons: Record<string, string> = {
          permission: '没有写入 /usr/local/bin 的权限',
          conflict: '已有其他来源的同名命令，未作更改',
          unavailable: '当前版本未包含可用的 CLI',
          busy: '操作进行中，请稍后重试',
        }
        toast.error(t(action === 'install' ? 'CLI 安装失败' : 'CLI 移除失败'), {
          id: 'cli-install',
          description: t(reasons[result.code] || '请稍后重试'),
        })
        void client.invalidateQueries({ queryKey: ['studio', 'cli-status'] })
        return
      }
      client.setQueryData(['studio', 'cli-status'], result.state)
      toast.success(t(action === 'install' ? 'CLI 已安装' : 'CLI 已移除'), {
        id: 'cli-install',
      })
    },
    onError: (_error, action) => {
      toast.error(t(action === 'install' ? 'CLI 安装失败' : 'CLI 移除失败'), {
        id: 'cli-install',
      })
    },
  })
  if (!state?.supported || (!state.development && !state.available)) return null
  const change = () => {
    if (!pending) mutate(state.installed ? 'remove' : 'install')
  }
  return (
    <section aria-labelledby='studio-cli' className='space-y-3'>
      <h2
        id='studio-cli'
        className='flex items-center gap-2 text-sm font-medium text-muted-foreground'
      >
        <Terminal className='size-4' aria-hidden='true' />
        {t('命令行')}
      </h2>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4'>
        <div className='space-y-1'>
          <p className='font-medium'>mediacrawler</p>
          <p className='text-sm text-muted-foreground'>
            {state.development
              ? t('开发模式不可安装')
              : state.conflict
                ? t('已有同名命令')
                : state.path}
          </p>
        </div>
        <Button
          variant='outline'
          disabled={pending || !state.available || state.conflict}
          onClick={() => void change()}
        >
          {pending ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : state.installed ? (
            <Unplug />
          ) : (
            <Download />
          )}
          {t(state.installed ? '移除命令' : '安装命令')}
        </Button>
      </div>
    </section>
  )
}
