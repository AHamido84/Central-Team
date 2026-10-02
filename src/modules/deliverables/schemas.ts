import { z } from 'zod';

import { annotationKinds, approvalDecisions, approvalStages } from '@/modules/deliverables/constants';
import { deliverableTypes } from '@/modules/workflows/constants';

export const createDeliverableSchema = z.object({
  taskId: z.uuid(),
  type: z.enum(deliverableTypes),
  title: z.string().trim().min(1, { message: 'required' }).max(200, { message: 'too_long' }),
  requiresInternalReview: z.boolean(),
  requiresClientApproval: z.boolean(),
});

export const updateDeliverableSchema = z.object({
  deliverableId: z.uuid(),
  title: z.string().trim().min(1, { message: 'required' }).max(200, { message: 'too_long' }).optional(),
  scheduledFor: z.iso.date({ message: 'invalid_date' }).nullable().optional(),
  requiresInternalReview: z.boolean().optional(),
  requiresClientApproval: z.boolean().optional(),
});

const fileName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((n) => !/[\\/\0]/.test(n), { message: 'validation' });

export const versionUploadSchema = z.object({
  versionId: z.uuid(),
  name: fileName,
  mimeType: z.string().min(3).max(120),
  size: z.number().int().positive(),
  /** A browser-made preview (image thumbnail or video poster) is uploaded next to the file. */
  withThumbnail: z.boolean(),
});

export const finalizeVersionFileSchema = versionUploadSchema.extend({
  fileId: z.uuid(),
  width: z.number().int().positive().max(100000).nullable(),
  height: z.number().int().positive().max(100000).nullable(),
  durationSeconds: z.number().nonnegative().max(86400).nullable(),
});

export const decisionSchema = z
  .object({
    versionId: z.uuid(),
    stage: z.enum(approvalStages),
    decision: z.enum(approvalDecisions),
    comment: z.string().trim().max(5000, { message: 'too_long' }),
  })
  .refine((v) => v.decision !== 'changes_requested' || v.comment.length >= 3, { message: 'comment_required', path: ['comment'] });

export const annotationSchema = z
  .object({
    versionId: z.uuid(),
    fileId: z.uuid().nullable(),
    kind: z.enum(annotationKinds),
    x: z.number().min(0).max(1).nullable(),
    y: z.number().min(0).max(1).nullable(),
    timeSeconds: z.number().min(0).max(86400).nullable(),
    body: z.string().trim().min(1, { message: 'required' }).max(5000, { message: 'too_long' }),
    visibility: z.enum(['internal', 'client']),
  })
  .refine((a) => a.kind !== 'point' || (a.x !== null && a.y !== null && a.fileId !== null), { message: 'validation', path: ['x'] })
  .refine((a) => a.kind !== 'timestamp' || (a.timeSeconds !== null && a.fileId !== null), { message: 'validation', path: ['timeSeconds'] });

export const replySchema = z.object({
  annotationId: z.uuid(),
  body: z.string().trim().min(1, { message: 'required' }).max(5000, { message: 'too_long' }),
});
export const resolveSchema = z.object({ annotationId: z.uuid(), resolved: z.boolean() });
