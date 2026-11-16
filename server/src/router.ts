import { authRouter } from './routers/auth';
import { systemRouter } from './routers/system';
import { entityRouter } from './routers/entity';
import { router } from './trpc';

export const appRouter = router({
  auth: authRouter,
  system: systemRouter,
  entity: entityRouter,
});

export type AppRouter = typeof appRouter;
