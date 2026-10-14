import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function EventsSection(props: SectionProps) {
  return <StageEditor {...props} stage="events" />;
}
