import { OffersView, type SearchParams } from './offers-view';

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <OffersView searchParams={searchParams} mode="all" />;
}
