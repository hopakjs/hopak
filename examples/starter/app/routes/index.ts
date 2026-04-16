import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: () => ({ message: 'Hopak.js is dancing.' }),
});
