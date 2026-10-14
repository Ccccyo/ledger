import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function ChildSection(props: SectionProps) {
  return <StageEditor {...props} stage="child" />;
}
