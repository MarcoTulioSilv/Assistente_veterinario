import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VetEquine', template: '%s — VetEquine' },
  description: 'Sistema de gestão veterinária equina',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'VetEquine' },
};

export const viewport: Viewport = {
  themeColor: '#1A3A5C',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
