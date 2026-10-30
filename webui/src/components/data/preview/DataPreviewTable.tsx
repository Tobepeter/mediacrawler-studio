import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'

interface DataPreviewTableProps {
  data: Record<string, unknown>[]
  columns?: string[]
}

export function DataPreviewTable({
  data,
  columns: propColumns,
}: DataPreviewTableProps) {
  const { t } = useTranslation('data')
  const [searchTerm, setSearchTerm] = useState('')

  // 自动获取列名（JSON 可能没有 columns）
  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    if (data.length === 0) return []
    return Object.keys(data[0])
  }, [data, propColumns])

  // 过滤数据
  const filteredData = useMemo(() => {
    if (!searchTerm) return data
    const term = searchTerm.toLowerCase()
    return data.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(term),
      ),
    )
  }, [data, searchTerm])

  // 格式化单元格值
  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  return (
    <div className='flex h-full flex-col'>
      {/* 搜索栏 */}
      <div className='mb-3 flex-shrink-0'>
        <div className='relative'>
          <Search className='text-cyber-text-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder={t('preview.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-9 pl-9 font-mono text-xs'
          />
        </div>
      </div>

      {/* 表格 */}
      <ScrollArea className='border-cyber-border-DEFAULT flex-1 rounded-lg border'>
        <div className='min-w-full'>
          <table className='w-full font-mono text-xs'>
            <thead className='bg-cyber-bg-tertiary border-cyber-border-DEFAULT sticky top-0 border-b'>
              <tr>
                <th className='text-cyber-text-muted w-12 px-3 py-2 text-left'>
                  #
                </th>
                {columns.map((col) => (
                  <th
                    key={col}
                    className='text-cyber-neon-cyan whitespace-nowrap px-3 py-2 text-left'
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, idx) => (
                <tr
                  key={idx}
                  className='border-cyber-border-subtle hover:bg-cyber-bg-elevated/50 border-b transition-colors'
                >
                  <td className='text-cyber-text-muted px-3 py-2'>{idx + 1}</td>
                  {columns.map((col) => (
                    <td
                      key={col}
                      className='text-cyber-text-primary max-w-xs truncate px-3 py-2'
                      title={formatCellValue(row[col])}
                    >
                      {formatCellValue(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>

      {/* 过滤结果提示 */}
      {searchTerm && (
        <div className='text-cyber-text-muted mt-2 flex-shrink-0 font-mono text-xs'>
          {t('preview.showing', {
            filtered: filteredData.length,
            total: data.length,
          })}
        </div>
      )}
    </div>
  )
}
