import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jobwatch',
  description: 'React offers collected by Node-RED, newest first',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
