'use server';

import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { activatePortalClient } from '@/modules/clients/server/portal-switch';

/** Switches the active client for portal users who belong to more than one client (ADR-091). */
export const switchClientAction = defineAction({
  input: z.object({ clientId: z.uuid() }),
  side: 'client',
  async handler() {
    return null;
  },
  async complete({ input }) {
    if (!(await activatePortalClient(input.clientId))) throw new ActionFailure('forbidden');
    return null;
  },
});
