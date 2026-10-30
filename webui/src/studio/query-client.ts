import { QueryClient } from '@tanstack/react-query'

// IPC 不依赖浏览器联网状态，不因聚焦/重连隐式重试用户操作
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { networkMode: 'always', retry: false },
  },
})
