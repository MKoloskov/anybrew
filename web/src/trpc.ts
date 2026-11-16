import { createTRPCReact } from '@trpc/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../server/src/router';

export const trpc = createTRPCReact<AppRouter>();

export type Out = inferRouterOutputs<AppRouter>;
export type System = Out['system']['get'];
export type Entity = Out['entity']['get'];
export type Audience = { all: boolean; players: string[]; parties: string[] };
export type SchemaNode = Entity['schema']['groups'][number]['children'][number];
