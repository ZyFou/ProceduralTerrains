CREATE TABLE projects (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NULL,
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  share_code CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_data LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_share_code (share_code),
  KEY idx_projects_user_updated (user_id, updated_at),
  KEY idx_projects_visibility_updated (visibility, updated_at),
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_projects_visibility CHECK (visibility IN ('private', 'unlisted', 'public'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
