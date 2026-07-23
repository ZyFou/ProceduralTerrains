ALTER TABLE projects
  ADD COLUMN content_revision INT UNSIGNED NOT NULL DEFAULT 1 AFTER project_data;
