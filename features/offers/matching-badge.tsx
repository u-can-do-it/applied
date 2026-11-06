import { Loader2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/hint';

/**
 * Where the fit badge goes while the AI is matching the job (lib/ai/matching.ts): dashed, so it doesn't
 * read as a score. A job it can't check (no profile, the AI filter off, no ad text) or failed on has
 * neither badge: nothing is coming for it until the next try.
 */
export function MatchingBadge() {
  return (
    <Hint wrap className="inline-flex" text="The AI is checking it against your profile">
      <Badge variant="dashed" className="gap-[3px] text-[13px]">
        <Loader2Icon className="animate-spin" />
        matching…
      </Badge>
    </Hint>
  );
}
