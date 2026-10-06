import type { SearchParams } from '@/lib/shared/search-params';
import { OffersView } from '@/features/offers/offers-view';

// "Mark applied" fetches the ad text in after(), from one board after another: allow the longest a
// function may run. ("Scrape now" in the header is POST /api/scrape, with a limit of its own.)
export const maxDuration = 300;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <OffersView searchParams={searchParams} />;
}
