import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { availablePath, transcriptContent } from '../transcript-file.mjs'

const transcript = {
  text: '第一句\n第二句',
  segments: [
    { start: 0, end: 20.02, text: '第一句' },
    { start: 3661.5, end: 3670, text: '第二句' },
  ],
}

test('SRT 带序号和毫秒时间轴', () => {
  assert.equal(
    transcriptContent(transcript, 'srt'),
    '1\n00:00:00,000 --> 00:00:20,020\n第一句\n\n2\n01:01:01,500 --> 01:01:10,000\n第二句\n',
  )
})

test('TXT 只有文字', () => {
  assert.equal(transcriptContent(transcript, 'txt'), '第一句\n第二句\n')
})

test('没有分段时 SRT 退回纯文字', () => {
  assert.equal(
    transcriptContent({ text: '全文', segments: [] }, 'srt'),
    '全文\n',
  )
})

test('同名文件不覆盖', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-transcript-'))
  const target = path.join(dir, '字幕.srt')
  assert.equal(availablePath(target), target)
  writeFileSync(target, 'x')
  assert.equal(availablePath(target), path.join(dir, '字幕 (2).srt'))
  writeFileSync(path.join(dir, '字幕 (2).srt'), 'x')
  assert.equal(availablePath(target), path.join(dir, '字幕 (3).srt'))
})
