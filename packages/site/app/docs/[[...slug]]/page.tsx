import { source } from '@/lib/source';
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { DocsBreadcrumbJsonLd, type BreadcrumbItem } from '@/components/json-ld';

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;

  // BreadcrumbList: Docs root, then each ancestor slug that resolves to a real
  // page, ending at the current page. Segments without their own page (pure
  // grouping folders like how-to/reference) are skipped.
  const breadcrumb: BreadcrumbItem[] = [{ name: 'Docs', url: '/docs' }];
  const slug = params.slug ?? [];
  for (let i = 0; i < slug.length; i++) {
    const ancestor = source.getPage(slug.slice(0, i + 1));
    if (ancestor) {
      breadcrumb.push({ name: ancestor.data.title, url: ancestor.url });
    }
  }

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsBreadcrumbJsonLd items={breadcrumb} />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const url = page.url;

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "article",
      url,
      title: page.data.title,
      description: page.data.description,
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
    },
  };
}
