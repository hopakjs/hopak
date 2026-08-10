import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
