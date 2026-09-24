import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upcoming } from '@/components/ui/Upcoming';

export const metadata: Metadata = { title: 'Aktivitas' };

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Aktivitas" sub="Semua pergerakan dana — tercatat di blockchain dan bisa diperiksa siapa pun." />
      <Upcoming icon="ledger" phase={3} what="Deposit, bond, pencairan, dan refund — lengkap dengan hash transaksinya." />
    </>
  );
}
