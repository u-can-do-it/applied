import { TALENT_POOL } from '@/lib/stages';
import { Badge } from '@/components/ui/badge';

/** In the talent pool: they keep your CV (a mark, not a status). */
export function TalentPool() {
  return (
    <Badge variant="pool" className="cursor-help font-normal" title={TALENT_POOL.hint}>
      {TALENT_POOL.label}
    </Badge>
  );
}
