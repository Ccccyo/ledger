import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function HousingSection(props: SectionProps) {
  return <StageEditor {...props} stage="housing" />;
}
