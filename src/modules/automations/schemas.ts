import { z } from 'zod';

import { conditionOps, notifyRecipients, settableStatuses, triggerTypes } from '@/modules/automations/constants';

const scalar = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

export const conditionSchema = z.object({
  field: z.string().regex(/^(event|lead|deal|request|task|campaign|deliverable|connection)\.[a-z_]+$/),
  op: z.enum(conditionOps),
  value: z.union([scalar, z.array(z.string().max(200)).max(50)]).optional(),
});

/** Text with `{{subject.field}}` placeholders; rendered by the engine, never evaluated. */
const template = (max: number) => z.string().trim().max(max);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('notify'),
    config: z.object({
      recipients: z.array(z.enum(notifyRecipients)).min(1),
      userIds: z.array(z.uuid()).max(20).default([]),
      title: template(120).min(1),
      body: template(500).default(''),
    }),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('assign'),
    config: z.object({ userIds: z.array(z.uuid()).min(1).max(20) }),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('create_task'),
    config: z.object({
      title: template(200).min(1),
      description: template(2000).default(''),
      dueInDays: z.number().int().min(0).max(365).default(1),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      assigneeIds: z.array(z.uuid()).max(10).default([]),
      departmentId: z.uuid().nullable().default(null),
    }),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('change_status'),
    config: z.object({
      status: z.enum([...settableStatuses.lead, ...settableStatuses.request, ...settableStatuses.task] as [string, ...string[]]),
    }),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('send_whatsapp'),
    config: z.object({
      to: z.enum(['record', 'phone']),
      phone: z.string().max(20).default(''),
      templateId: z.uuid(),
      params: z.array(template(200)).max(10).default([]),
    }),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('webhook'),
    config: z.object({ url: z.url({ protocol: /^https$/ }).max(500) }),
  }),
]);

export const automationInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  isActive: z.boolean().default(false),
  triggerType: z.enum(triggerTypes),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});

export const idSchema = z.object({ id: z.uuid() });
export const toggleSchema = z.object({ id: z.uuid(), isActive: z.boolean() });
export const dryRunSchema = z.object({ id: z.uuid(), eventId: z.uuid().nullable().default(null) });
