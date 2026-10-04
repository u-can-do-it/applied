import type { Metadata, Viewport } from 'next';
import { ConfirmProvider } from '@/components/confirm';
import { QueryProvider } from '@/components/query-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServiceWorker } from '@/features/shell/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jobwatch',
  description: 'Job offers from several boards, newest first',
  robots: { index: false, follow: false },
  // the manifest (app/manifest.ts) is linked by Next itself
  icons: { icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }] },
};

// the browser's bar (and the installed app's) in the page's colour: --background in app/globals.css
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <TooltipProvider delayDuration={150}>
            <ConfirmProvider>{children}</ConfirmProvider>
          </TooltipProvider>
        </QueryProvider>
        {/* at the top: an open Sheet keeps its buttons at the bottom */}
        <Toaster position="top-center" />
        <ServiceWorker />
      </body>
    </html>
  );
}
