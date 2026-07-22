ALTER TABLE users
  ADD COLUMN default_project_visibility VARCHAR(16) NOT NULL DEFAULT 'private' AFTER website_url,
  ADD COLUMN avatar_mime_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER default_project_visibility,
  ADD COLUMN avatar_data MEDIUMBLOB NULL AFTER avatar_mime_type,
  ADD COLUMN avatar_updated_at DATETIME(3) NULL AFTER avatar_data,
  ADD CONSTRAINT chk_users_default_project_visibility
    CHECK (default_project_visibility IN ('private', 'unlisted', 'public'));
