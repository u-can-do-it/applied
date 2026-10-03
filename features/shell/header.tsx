import { AutoRefresh } from './auto-refresh';
import { ScrapeButton } from '@/features/scraping/scrape-button';

export function Header() {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-3 max-[480px]:flex-wrap">
      <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">Jobwatch</h1>
      <div className="flex items-center gap-3">
        <ScrapeButton />
        <AutoRefresh />
      </div>
    </header>
  );
}
