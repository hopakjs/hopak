import { type Logger, pluralize } from '@hopak/common';
import type { Database } from '../db/client';
import { defineRoute } from '../http/route';
import type { Router } from '../http/router';
import type { HttpMethod, RouteHandler } from '../http/types';
import type { ModelDefinition } from '../model/define';
import {
  type CrudDependencies,
  createCreateHandler,
  createDeleteHandler,
  createFindOneHandler,
  createListHandler,
  createUpdateHandler,
} from './handlers';

export interface RegisterCrudOptions {
  router: Router;
  db: Database;
  models: readonly ModelDefinition[];
  prefix?: string;
  log?: Logger;
}

export interface SkippedRoute {
  method: HttpMethod;
  pattern: string;
  reason: string;
}

export interface RegisterCrudResult {
  registered: number;
  skipped: SkippedRoute[];
}

interface CrudRoute {
  method: HttpMethod;
  pattern: string;
  handler: RouteHandler;
}

const DEFAULT_PREFIX = '/api';
const ID_SEGMENT = '[id]';
const OVERRIDDEN_REASON = 'overridden by file route';

function buildCrudRoutes(deps: CrudDependencies, prefix: string): CrudRoute[] {
  const collection = `${prefix}/${pluralize(deps.model.name)}`;
  const item = `${collection}/${ID_SEGMENT}`;

  return [
    { method: 'GET', pattern: collection, handler: createListHandler(deps) },
    { method: 'GET', pattern: item, handler: createFindOneHandler(deps) },
    { method: 'POST', pattern: collection, handler: createCreateHandler(deps) },
    { method: 'PUT', pattern: item, handler: createUpdateHandler(deps, false) },
    { method: 'PATCH', pattern: item, handler: createUpdateHandler(deps, true) },
    { method: 'DELETE', pattern: item, handler: createDeleteHandler(deps) },
  ];
}

export function registerCrudRoutes(options: RegisterCrudOptions): RegisterCrudResult {
  const result: RegisterCrudResult = { registered: 0, skipped: [] };
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  for (const model of options.models) {
    if (!model.options.crud) continue;
    const source = `auto-crud:${model.name}`;

    for (const route of buildCrudRoutes({ db: options.db, model }, prefix)) {
      if (options.router.has(route.method, route.pattern)) {
        const skipped: SkippedRoute = {
          method: route.method,
          pattern: route.pattern,
          reason: OVERRIDDEN_REASON,
        };
        result.skipped.push(skipped);
        options.log?.debug('CRUD route skipped — already registered', skipped);
        continue;
      }
      options.router.add(
        route.method,
        route.pattern,
        defineRoute({ handler: route.handler }),
        source,
      );
      result.registered += 1;
    }
  }

  return result;
}
