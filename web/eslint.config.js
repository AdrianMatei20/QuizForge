// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

// CLAUDE.md: model output is rendered as text. These rules make the two ways
// around Angular's escaping a lint error, not just a convention.
const NO_SANITIZER_BYPASS =
  'Model output must be rendered as text: never bypass Angular sanitization (bypassSecurityTrust*).';
const NO_HTML_BINDING =
  'Model output must be rendered as text: use {{ }} interpolation, never [innerHTML] or [outerHTML].';

module.exports = defineConfig([
  {
    // Generated from postman/openapi.json by `npm run api:types`.
    ignores: ['src/app/core/api/openapi.generated.ts'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      'no-restricted-syntax': [
        'error',
        // sanitizer.bypassSecurityTrustHtml(...)
        {
          selector: 'MemberExpression[property.name=/^bypassSecurityTrust/]',
          message: NO_SANITIZER_BYPASS,
        },
        // sanitizer['bypassSecurityTrustHtml'](...)
        {
          selector: 'MemberExpression[property.value=/^bypassSecurityTrust/]',
          message: NO_SANITIZER_BYPASS,
        },
        // const { bypassSecurityTrustHtml } = sanitizer;
        { selector: 'Property[key.name=/^bypassSecurityTrust/]', message: NO_SANITIZER_BYPASS },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      'no-restricted-syntax': [
        'error',
        // [innerHTML]="...", bind-innerHTML="...", and the same for outerHTML.
        { selector: 'BoundAttribute[name=/^(innerHTML|outerHTML)$/i]', message: NO_HTML_BINDING },
      ],
    },
  },
]);
