import { OffersView, type SearchParams } from './offers-view';

// "Scrape now" runs in this page's server action: a full run takes seconds, allow plenty
export const maxDuration = 300;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <OffersView searchParams={searchParams} mode="all" />;
}
