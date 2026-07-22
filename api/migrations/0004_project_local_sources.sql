ALTER TABLE projects
  ADD COLUMN source_project_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER user_id,
  ADD UNIQUE KEY uq_projects_user_source (user_id, source_project_id);
