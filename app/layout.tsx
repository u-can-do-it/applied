import type { Metadata } from 'next';
import { ConfirmProvider } from '@/components/confirm';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jobwatch',
  description: 'Job offers from several boards, newest first',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider delayDuration={150}>
          <ConfirmProvider>{children}</ConfirmProvider>
        </TooltipProvider>
        {/* at the top: an open Sheet keeps its buttons at the bottom */}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
