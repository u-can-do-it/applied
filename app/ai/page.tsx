import type { Metadata } from 'next';
import type { SearchParams } from '@/lib/shared/search-params';
import { OffersView } from '@/features/offers/offers-view';

export const metadata: Metadata = { title: 'Jobwatch · AI filter' };

// AI runs work in after() and in this page's server actions, and "Mark applied" fetches the ad text
// in after(): allow the longest a Vercel function may run on the free plan (the run continues in
// slices if it needs longer)
export const maxDuration = 300;

export default function AiPage({ searchParams }: { searchParams: SearchParams }) {
  return <OffersView searchParams={searchParams} mode="ai" />;
}
