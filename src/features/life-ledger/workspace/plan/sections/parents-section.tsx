import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function ParentsSection(props: SectionProps) {
  return <StageEditor {...props} stage="parents" />;
}
