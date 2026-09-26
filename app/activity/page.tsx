import type { Metadata } from 'next';
import { ActivityView } from '@/components/activity/ActivityView';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'Aktivitas' };

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Aktivitas" sub="Semua pergerakan dana — tercatat di blockchain dan bisa diperiksa siapa pun." />
      <ActivityView />
    </>
  );
}
