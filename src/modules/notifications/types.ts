/** Notification catalog. Each type has `notifications.types.<type>.title|body` translations. */
export const notificationCategories = ['account', 'messages', 'files', 'requests', 'tasks', 'approvals', 'campaigns'] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

export const notificationTypes = {
  invitation_accepted: 'account',
  roles_changed: 'account',
  message_new: 'messages',
  mention: 'messages',
  file_shared: 'files',
  file_uploaded_by_client: 'files',
  request_submitted: 'requests',
  request_assigned: 'requests',
  request_status_changed: 'requests',
  request_needs_info: 'requests',
  task_assigned: 'tasks',
  task_due_soon: 'tasks',
  task_overdue: 'tasks',
  task_unblocked: 'tasks',
  task_review_requested: 'tasks',
  review_requested: 'tasks',
  deliverable_approved: 'tasks',
  deliverable_changes_requested: 'tasks',
  approval_requested: 'approvals',
  approval_reminder: 'approvals',
  campaign_started: 'campaigns',
  campaign_at_risk: 'campaigns',
  campaign_metrics_stale: 'campaigns',
  report_published: 'campaigns',
  report_ready: 'campaigns',
} as const satisfies Record<string, NotificationCategory>;

export type NotificationType = keyof typeof notificationTypes;

export type NotificationItem = {
  id: string;
  type: NotificationType;
  params: Record<string, string | number>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  actor: { name: string; avatarPath: string | null } | null;
};
