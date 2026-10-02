import { AutoRefresh } from './auto-refresh';
import { ScrapeButton } from './scrape-button';

export function Header() {
  return (
    <header className="top">
      <h1>Jobwatch</h1>
      <div className="top-side">
        <ScrapeButton />
        <AutoRefresh />
      </div>
    </header>
  );
}
