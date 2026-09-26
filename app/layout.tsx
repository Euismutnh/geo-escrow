import type { Metadata } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { Shell } from '@/components/shell/Shell';
import { Providers } from './providers';
import './globals.css';

/*
 * next/font mengunduh font saat BUILD dan menyajikannya dari domain sendiri:
 * browser pengguna tidak pernah menghubungi Google. Keduanya variable font
 * (wght 200-800 dan 100-800), jadi tidak perlu menyebut ketebalan.
 *
 * Plus Jakarta Sans dipilih di Fase 1 (dirancang di Jakarta).
 * JetBrains Mono HANYA untuk alamat, hash, dan id teknis — bukan uang.
 */
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'GEO Escrow', template: '%s · GEO Escrow' },
  description: 'Escrow freelance yang mencairkan dana saat AI benar-benar mulai menyebut brand Anda.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="id" className={`${jakarta.variable} ${jetbrains.variable}`}>
      {/* Ekstensi browser (Grammarly, dsb.) menyisipkan atribut ke <body>
          sebelum React hidrasi. suppressHydrationWarning hanya mengabaikan
          perbedaan ATRIBUT di tag ini saja — anak-anaknya tetap diperiksa. */}
      <body suppressHydrationWarning>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
