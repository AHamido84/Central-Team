import { z } from 'zod';

import { sensitivities } from '@/modules/ai/insights-core';

const uuid = z.uuid();

export const insightStatusSchema = z.object({
  insightId: uuid,
  status: z.enum(['open', 'acknowledged', 'dismissed']),
  reason: z.string().trim().max(500).optional(),
});

export const decideRecommendationSchema = z.discriminatedUnion('decision', [
  z.object({
    recommendationId: uuid,
    decision: z.literal('accepted'),
    assigneeId: uuid.nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
  }),
  z.object({ recommendationId: uuid, decision: z.literal('dismissed'), reason: z.string().trim().max(500).optional() }),
]);

export const explainInsightSchema = z.object({ insightId: uuid });

export const draftReportSectionSchema = z.object({
  reportId: uuid,
  section: z.enum(['commentary', 'next_steps']),
});

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  sensitivity: z.enum(sensitivities),
  autoDraftReports: z.boolean(),
  monthlyTokenBudget: z.coerce.number().int().min(0).max(1_000_000_000),
});

export const askSchema = z.object({
  conversationId: uuid.optional(),
  question: z.string().trim().min(2).max(2000),
});

export const renameConversationSchema = z.object({ conversationId: uuid, title: z.string().trim().min(1).max(120) });

export const conversationIdSchema = z.object({ conversationId: uuid });

export const emptySchema = z.object({});
