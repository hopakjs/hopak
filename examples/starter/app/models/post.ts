import { boolean, model, text } from '@hopak/core';

export default model(
  'post',
  {
    title: text().required().min(3).max(200),
    content: text().required(),
    published: boolean().default(false),
  },
  { crud: true },
);
