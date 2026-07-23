ALTER TABLE users
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user' AFTER status,
  ADD KEY idx_users_role_status (role, status),
  ADD CONSTRAINT chk_users_role CHECK (role IN ('user', 'admin'));

CREATE TABLE visit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip_hash BINARY(32) NOT NULL,
  path VARCHAR(255) NOT NULL,
  referrer_host VARCHAR(255) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_visit_events_created (created_at),
  KEY idx_visit_events_user_created (user_id, created_at),
  KEY idx_visit_events_unique_created (ip_hash, created_at),
  CONSTRAINT fk_visit_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE security_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_type VARCHAR(48) NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  ip_hash BINARY(32) NOT NULL,
  identifier_hash BINARY(32) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_security_events_created (created_at),
  KEY idx_security_events_type_created (event_type, created_at),
  KEY idx_security_events_user_created (user_id, created_at),
  CONSTRAINT fk_security_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_security_events_outcome CHECK (outcome IN ('success', 'failure', 'blocked'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE admin_audit_logs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NULL,
  metadata JSON NULL,
  ip_hash BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_audit_logs_created (created_at),
  KEY idx_admin_audit_logs_actor_created (admin_user_id, created_at),
  KEY idx_admin_audit_logs_target (target_type, target_id),
  CONSTRAINT fk_admin_audit_logs_user FOREIGN KEY (admin_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
