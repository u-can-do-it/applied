import { Loader2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Where the fit badge goes while the AI is matching the job (lib/ai/matching.ts): dashed, so it doesn't
 * read as a score. A job it can't check (no profile, the AI filter off, no ad text) or failed on has
 * neither badge: nothing is coming for it until the next try.
 */
export function MatchingBadge() {
  return (
    <Badge variant="dashed" className="gap-[3px] text-[13px]" title="The AI is checking it against your profile">
      <Loader2Icon className="animate-spin" />
      matching…
    </Badge>
  );
}
