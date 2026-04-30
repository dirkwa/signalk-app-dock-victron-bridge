const { defineConfig, globalIgnores } = require('eslint/config')
const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const prettier = require('eslint-config-prettier/flat')
const globals = require('globals')

module.exports = defineConfig([
  globalIgnores(['dist', 'node_modules']),

  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended, prettier],
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error'
    }
  }
])
