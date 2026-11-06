import { TALENT_POOL } from '@/lib/stages';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/hint';

/** In the talent pool: they keep your CV (a mark, not a status). */
export function TalentPool() {
  return (
    <Hint wrap className="inline-flex" text={TALENT_POOL.hint}>
      <Badge variant="pool" className="cursor-help font-normal">
        {TALENT_POOL.label}
      </Badge>
    </Hint>
  );
}
