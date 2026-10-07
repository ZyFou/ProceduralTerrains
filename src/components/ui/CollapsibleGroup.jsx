import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import ControlSection from './ControlSection.jsx';

export default function CollapsibleGroup({
  title,
  icon,
  defaultOpen = false,
  forceOpen = false,
  settingId,
  onToggle,
  children,
}) {
  useLanguage();
  return (
    <ControlSection
      title={translateText(title)}
      icon={icon}
      defaultOpen={defaultOpen}
      forceOpen={forceOpen}
      settingId={settingId}
      onToggle={onToggle}
    >
      {children}
    </ControlSection>
  );
}
import React from 'react';

