export function shouldForceSectionOpen(settingsTarget, sectionSettingId, options = {}) {
  const { sectionLabel, childPrefixes = [] } = options;
  const id = settingsTarget?.settingId;
  if (!id) return false;
  if (id === sectionSettingId) return true;
  if (sectionLabel && settingsTarget?.sectionLabel === sectionLabel) return true;
  return childPrefixes.some((prefix) => id.startsWith(prefix));
}
