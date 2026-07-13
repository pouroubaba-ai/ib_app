import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';

const geist = Geist({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'IB APP',
  description: 'Gestion de stock et finances',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className={`${geist.className} h-full bg-gray-50 dark:bg-gray-950`}>
        <ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
