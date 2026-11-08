import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(
  new URL('../../webui/src/studio/media-options.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const { videoQualities } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

test('实际画质去重，竖屏按短边，不把音轨和未知尺寸编造成档位', () => {
  assert.deepEqual(videoQualities({}), [])
  assert.deepEqual(
    videoQualities({
      media: {
        variants: [
          { kind: 'video', width: 1080, height: 1920 },
          { kind: 'video', width: 1920, height: 1080 },
          { kind: 'video', width: 1280, height: 720 },
          { kind: 'video', width: null, height: null },
          { kind: 'audio', height: 999 },
        ],
      },
    }),
    ['1080p', '720p'],
  )
})
