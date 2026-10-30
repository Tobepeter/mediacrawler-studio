import { Terminal } from '@/components/console/Terminal'
import { useLogWebSocket } from '@/hooks/useWebSocket'

export function MainContent() {
  // Connect to WebSocket for logs
  useLogWebSocket()

  return (
    <main className='relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden'>
      <Terminal />
    </main>
  )
}
