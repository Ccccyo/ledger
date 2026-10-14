import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function PartnerSection(props: SectionProps) {
  return <StageEditor {...props} stage="partner" />;
}
