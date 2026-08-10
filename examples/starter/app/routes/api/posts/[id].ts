import { crud } from '@hopak/core';
import post from '../../../models/post';

export const GET = crud.read(post);
export const PUT = crud.update(post);
export const PATCH = crud.patch(post);
export const DELETE = crud.remove(post);
