import { lazy, Suspense } from 'react';

// Both packages are lazy-loaded together behind one Suspense boundary so
// BrixBar (mounted on almost every /app/* page) never pulls markdown-parsing
// code into the initial bundle unless a chat message actually needs it.
const LazyMarkdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
  ]);
  // eslint-disable-next-line react/prop-types
  return { default: (props) => <ReactMarkdown remarkPlugins={[remarkGfm]} {...props} /> };
});

function PlainTextFallback({ text }) {
  return (text || '').split('\n').filter(Boolean).map((line, i) => <div key={i}>{line}</div>);
}

// `variant` selects which surface's scoped CSS class wraps the output
// ("bxb-md" for BrixBar, "bai-md" for BrixAiPage) so each surface's own
// <style> block governs typography/spacing independently.
export default function MarkdownMessage({ text, variant }) {
  if (!text) return null;
  return (
    <div className={variant}>
      <Suspense fallback={<PlainTextFallback text={text} />}>
        <LazyMarkdown>{text}</LazyMarkdown>
      </Suspense>
    </div>
  );
}
