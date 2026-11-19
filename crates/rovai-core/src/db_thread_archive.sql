CREATE INDEX camp_archive_list_idx ON camp(id)
WHERE archived_at IS NOT NULL AND deletion_operation_id IS NULL;
