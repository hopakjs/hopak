import { defineConfig } from '@hopak/core';

export default defineConfig({
  database: { dialect: 'sqlite', file: '.hopak/data.db' },
});
