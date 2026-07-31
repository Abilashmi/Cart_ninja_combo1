import { lazy, Suspense } from 'react';

// Matches #rgb / #rrggbb anywhere in message text (both plain text and
// inline-code spans, since the AST walk below runs on raw text nodes
// regardless of which markdown construct wraps them).
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

// Small remark plugin: splits any text node containing hex color codes into
// plain-text pieces plus custom "swatch" nodes. Setting data.hName/hProperties
// on an mdast node (even a plain `text` node) is the standard way to make
// mdast-util-to-hast emit a custom element for it instead of plain text — the
// original text is kept as that element's child automatically (see
// mdast-util-to-hast's applyData: a non-element result gets wrapped as
// `children: [result]` when hName is set), so the hex code itself still
// renders, just wrapped with a swatch.
function remarkHexSwatches() {
  return (tree) => walk(tree);

  function walk(node) {
    if (!Array.isArray(node.children)) return;
    const next = [];
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string' && HEX_COLOR_RE.test(child.value)) {
        HEX_COLOR_RE.lastIndex = 0;
        let lastIndex = 0;
        let match;
        while ((match = HEX_COLOR_RE.exec(child.value))) {
          if (match.index > lastIndex) {
            next.push({ type: 'text', value: child.value.slice(lastIndex, match.index) });
          }
          next.push({
            type: 'text',
            value: match[0],
            data: { hName: 'brixswatch', hProperties: { hex: match[0] } },
          });
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < child.value.length) {
          next.push({ type: 'text', value: child.value.slice(lastIndex) });
        }
      } else if (child.type === 'inlineCode' && typeof child.value === 'string' && HEX_COLOR_RE.test(child.value)) {
        // Inline code (`#1a9de0`) is a leaf node with no `.children` to split
        // the way plain text is above, and overriding hName on it directly
        // would replace its <code> tag (losing the monospace/code styling).
        // Instead, insert a dot-only marker node right before the untouched
        // inlineCode node, so the code span still renders normally with a
        // swatch immediately to its left.
        HEX_COLOR_RE.lastIndex = 0;
        const match = HEX_COLOR_RE.exec(child.value);
        next.push({ type: 'text', value: '', data: { hName: 'brixswatch', hProperties: { hex: match[0] } } });
        next.push(child);
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  }
}

function BrixSwatch({ hex, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        aria-hidden="true"
        style={{
          width: 11,
          height: 11,
          borderRadius: '50%',
          background: hex,
          border: '1px solid rgba(0,0,0,0.18)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.6) inset',
          flexShrink: 0,
        }}
      />
      {children}
    </span>
  );
}

// Both packages are lazy-loaded together behind one Suspense boundary so
// BrixBar (mounted on almost every /app/* page) never pulls markdown-parsing
// code into the initial bundle unless a chat message actually needs it.
const LazyMarkdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
  ]);
  // eslint-disable-next-line react/prop-types
  return {
    default: (props) => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHexSwatches]}
        components={{ brixswatch: BrixSwatch }}
        {...props}
      />
    ),
  };
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
