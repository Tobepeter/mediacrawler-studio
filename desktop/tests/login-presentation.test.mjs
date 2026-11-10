import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(
  new URL('../../webui/package.json', import.meta.url),
)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

test('已有历史结果时主动扫码仍可展示，登录完成后恢复结果且不卸载结果组件', async () => {
  const source = await readFile(
    new URL('../../webui/src/App.tsx', import.meta.url),
    'utf8',
  )
  const ast = ts.createSourceFile(
    'App.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const imports = ast.statements.filter(ts.isImportDeclaration)
  const names = imports
    .flatMap((node) => [
      node.importClause?.name?.text,
      ...(node.importClause?.namedBindings?.elements?.map(
        (item) => item.name.text,
      ) || []),
    ])
    .filter(Boolean)
  let body = source
  for (const node of [...imports].reverse())
    body = body.slice(0, node.pos) + body.slice(node.end)
  const state = {
    platform: 'bili',
    tasks: {},
    views: { bili: { historyId: '' } },
    accounts: { bili: 'expired' },
    pages: { bili: { id: 'history' } },
    loginView: { platform: 'bili', mode: 'qrcode', preparing: true },
  }
  globalThis.window = { studio: { platform: 'darwin' } }
  globalThis.appFixture = Object.fromEntries(
    names.map((name) => [
      name,
      (props) =>
        React.createElement(
          'div',
          { 'data-component': name, className: props?.className },
          props?.children,
        ),
    ]),
  )
  Object.assign(globalThis.appFixture, {
    React,
    useTranslation: () => ({ t: (key) => key }),
    useEffect() {},
    useStudio: (selector) => selector(state),
    useStudioRoute: () => 'collect',
    accountChecking: () => false,
    cn: (...values) => values.filter(Boolean).join(' '),
    appIcon: 'icon.png',
  })
  const code = ts.transpileModule(
    `const {React, ${names.join(',')}} = globalThis.appFixture;\n${body}`,
    {
      compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
    },
  ).outputText
  const { default: App } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  )
  try {
    for (const preparing of [true, false]) {
      state.loginView.preparing = preparing
      const html = renderToStaticMarkup(React.createElement(App))
      assert.match(html, /data-component="LoginPanel"/)
      assert.match(html, /class="hidden"><div data-component="Results"/)
    }
    state.accounts.bili = 'connected'
    state.loginView = null
    const html = renderToStaticMarkup(React.createElement(App))
    assert.doesNotMatch(html, /data-component="LoginPanel"/)
    assert.match(html, /class="contents"><div data-component="Results"/)
    // 主动打开本地历史无需登录；返回扫码后仍保留结果组件
    state.accounts.bili = 'expired'
    state.logins = { bili: { status: 'error' } }
    state.views.bili.historyId = 'history'
    const offline = renderToStaticMarkup(React.createElement(App))
    assert.doesNotMatch(offline, /data-component="LoginPanel"/)
    assert.match(offline, /class="contents"><div data-component="Results"/)
    state.views.bili.historyId = ''
    const login = renderToStaticMarkup(React.createElement(App))
    assert.match(login, /data-component="LoginPanel"/)
    assert.match(login, /class="hidden"><div data-component="Results"/)
  } finally {
    delete globalThis.window
    delete globalThis.appFixture
  }
})
