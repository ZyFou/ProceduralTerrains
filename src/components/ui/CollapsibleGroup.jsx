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
  return (
    <ControlSection
      title={title}
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

