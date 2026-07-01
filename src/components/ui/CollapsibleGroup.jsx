import ControlSection from './ControlSection.jsx';

export default function CollapsibleGroup({
  title,
  icon,
  defaultOpen = false,
  forceOpen = false,
  statusDot,
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
      statusDot={statusDot}
      settingId={settingId}
      onToggle={onToggle}
    >
      {children}
    </ControlSection>
  );
}
