/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// One Cart Image Banner image (desktop or mobile): upload, or paste an https
// link. Uploads are resized and compressed in the browser into a data URL that
// is saved with the cart drawer settings (the app has no Shopify Files access);
// the storefront then loads it as a real, long-cached image file through
// php_backend/cart_banner_image.php. SVGs are drawn to a bitmap here, so no
// SVG ever reaches the storefront.
import { useState } from 'react';
import { BlockStack, Button, DropZone, InlineError, InlineStack, Text, TextField } from '@shopify/polaris';
import { BANNER_IMAGE_MAX_CHARS, isValidBannerImage } from '../../utils/cart-banner.shared';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

function shrinkImage(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      const w0 = img.naturalWidth || maxWidth;
      const h0 = img.naturalHeight || Math.round(maxWidth / 3);
      const scale = Math.min(1, maxWidth / w0);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let out = '';
      for (const quality of [0.86, 0.78, 0.68, 0.56]) {
        out = canvas.toDataURL('image/webp', quality);
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality); // browsers without WebP export
        if (out.length <= BANNER_IMAGE_MAX_CHARS) break;
      }
      if (out.length > BANNER_IMAGE_MAX_CHARS) reject(new Error('That image is too large to store even after compressing. Try a smaller or simpler image.'));
      else resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("We couldn't read that image. Use a PNG, JPG, WebP, GIF or SVG.")); };
    img.src = src;
  });
}

export function BannerImageField({ label, value, onChange, maxWidth, helpText, emptyHint }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [dialog, setDialog] = useState(false);
  const [url, setUrl] = useState(value && value.startsWith('https://') ? value : '');

  const onDrop = async (_all, accepted, rejected) => {
    setProblem('');
    if (rejected.length && !accepted.length) { setProblem('Use a PNG, JPG, WebP, GIF or SVG image.'); return; }
    const file = accepted[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setProblem('That file is over 15 MB. Use a smaller image.'); return; }
    setBusy(true);
    try {
      onChange(await shrinkImage(file, maxWidth));
      setUrl('');
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  };
  const applyUrl = () => {
    const next = url.trim();
    if (!isValidBannerImage(next)) { setProblem('Use an image link that starts with https://'); return; }
    setProblem('');
    onChange(next);
  };

  return (
    <BlockStack gap="200">
      <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
      {value ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: 10, border: '1px solid #e1e3e5', background: '#fff' }}>
          <img src={value} alt={label} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 140, objectFit: 'contain', borderRadius: 6, background: '#f6f6f7' }} />
          <InlineStack gap="200">
            <Button size="slim" onClick={() => setDialog(true)} loading={busy}>Replace</Button>
            <Button size="slim" tone="critical" variant="plain" onClick={() => { onChange(''); setUrl(''); }}>Remove</Button>
          </InlineStack>
          <div style={{ display: 'none' }}>
            <DropZone accept={ACCEPT} type="image" allowMultiple={false} openFileDialog={dialog} onFileDialogClose={() => setDialog(false)} onDrop={onDrop} />
          </div>
        </div>
      ) : (
        <DropZone accept={ACCEPT} type="image" allowMultiple={false} onDrop={onDrop} label={label} labelHidden>
          <DropZone.FileUpload actionTitle={busy ? 'Preparing…' : 'Select image'} actionHint={emptyHint} />
        </DropZone>
      )}
      <InlineStack gap="200" blockAlign="end" wrap={false}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextField label="Or use an image link" value={url} onChange={setUrl} placeholder="https://cdn.shopify.com/…/banner.jpg" autoComplete="off" />
        </div>
        <Button onClick={applyUrl} disabled={!url.trim() || url.trim() === value}>Use link</Button>
      </InlineStack>
      {problem && <InlineError message={problem} fieldID={`banner-${label}`} />}
      {helpText && <Text as="p" variant="bodySm" tone="subdued">{helpText}</Text>}
    </BlockStack>
  );
}
