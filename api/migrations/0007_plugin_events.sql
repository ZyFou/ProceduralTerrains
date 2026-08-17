CREATE TABLE plugin_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip_hash BINARY(32) NOT NULL,
  event_name VARCHAR(48) NOT NULL,
  plugin VARCHAR(32) NOT NULL,
  version VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_plugin_events_created (created_at),
  KEY idx_plugin_events_plugin_event_created (plugin, event_name, created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
