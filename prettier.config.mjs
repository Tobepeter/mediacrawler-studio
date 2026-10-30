/** @type {import('prettier').Config} */
export default {
  tabWidth: 2,
  printWidth: 80,
  singleQuote: true,
  jsxSingleQuote: true,
  semi: false,
  trailingComma: 'all',
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindConfig: './webui/tailwind.config.ts',
  tailwindFunctions: ['cn', 'clsx', 'cva'],
}
