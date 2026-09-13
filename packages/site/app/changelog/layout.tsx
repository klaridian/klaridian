import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';

// The changelog uses the marketing/home shell (not the docs sidebar shell) —
// it's a reverse-chronological feed, not nested reference navigation. See
// ARCHITECTURE.md §76.
export default function Layout({ children }: { children: ReactNode }) {
  return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
