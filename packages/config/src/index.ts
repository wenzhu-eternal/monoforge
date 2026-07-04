export const biomeConfig = {
  $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
  organizeImports: {
    enabled: true,
  },
  linter: {
    enabled: true,
    rules: {
      recommended: true,
      correctness: {
        noUnusedImports: 'warn',
        noUnusedVariables: 'warn',
      },
      suspicious: {
        noExplicitAny: 'warn',
      },
      style: {
        noNonNullAssertion: 'warn',
      },
    },
  },
  formatter: {
    enabled: true,
    indentStyle: 'space',
    indentWidth: 2,
    lineWidth: 100,
  },
  javascript: {
    formatter: {
      quoteStyle: 'single',
      semicolons: 'asNeeded',
    },
  },
}

export const tsConfig = {
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    outDir: './dist',
    rootDir: './src',
  },
  include: ['src/**/*.ts'],
  exclude: ['node_modules', 'dist'],
}
