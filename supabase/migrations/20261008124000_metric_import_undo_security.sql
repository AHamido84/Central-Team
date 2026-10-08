-- Feedback Round 6 (ADR-095): "Undo import" marks the import entry as undone (the entry stays as history).
-- Only the undo columns may change, and only for people who manage metrics of that client.
create policy metric_imports_update on public.metric_imports for update to authenticated
  using ((select app.agency_can_task(client_id, 'metrics:manage')))
  with check ((select app.agency_can_task(client_id, 'metrics:manage')));
revoke update on public.metric_imports from authenticated;
grant update (undone_at, undone_by) on public.metric_imports to authenticated;
