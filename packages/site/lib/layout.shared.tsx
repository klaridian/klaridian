import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-mono font-bold">
          klaridian<span className="text-[var(--klaridian-accent)]">()</span>
        </span>
      ),
    },
    links: [
      { text: 'Docs', url: '/docs' },
      { text: 'GitHub', url: 'https://github.com/klaridian/klaridian' },
    ],
  };
}
