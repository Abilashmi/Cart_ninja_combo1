/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useState } from 'react';
import { BlockStack, Button, DropZone, InlineStack, InlineError, Text, TextField } from '@shopify/polaris';
import { COD_LOGO_MAX_CHARS, isValidCodLogo } from '../../utils/cod.shared';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

// Shrinks a logo in the browser (max 320x96) and turns it into a small
// WebP/PNG data URL, so it can be stored with the COD settings (the app has no
// file storage of its own). SVGs are drawn to a bitmap here, so no SVG ever
// reaches the storefront.
function shrinkLogo(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      const w0 = img.naturalWidth || 320;
      const h0 = img.naturalHeight || 96;
      const scale = Math.min(1, 320 / w0, 96 / h0);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let out = '';
      for (const quality of [0.92, 0.8, 0.65, 0.5]) {
        out = canvas.toDataURL('image/webp', quality);
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png'); // browsers without WebP export
        if (out.length <= COD_LOGO_MAX_CHARS) break;
      }
      if (out.length > COD_LOGO_MAX_CHARS) reject(new Error('That logo is too detailed to store. Try a simpler PNG or a smaller file.'));
      else resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("We couldn't read that image. Try a PNG, JPG, WebP or SVG.")); };
    img.src = src;
  });
}

export default function LogoUploader({ value, onChange, error }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [dialog, setDialog] = useState(false);
  const [url, setUrl] = useState(value && value.startsWith('https://') ? value : '');

  const onDrop = async (_all, accepted, rejected) => {
    setProblem('');
    if (rejected.length && !accepted.length) { setProblem('Use a PNG, JPG, WebP or SVG image.'); return; }
    const file = accepted[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setProblem('That file is over 5 MB. Use a smaller image.'); return; }
    setBusy(true);
    try {
      onChange(await shrinkLogo(file));
      setUrl('');
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  };
  const applyUrl = () => {
    const next = url.trim();
    if (!isValidCodLogo(next)) { setProblem('Use an image link that starts with https://'); return; }
    setProblem('');
    onChange(next);
  };

  return (
    <BlockStack gap="200">
      {value ? (
        <div className="cod-logo-box">
          <div className="cod-logo-img"><img src={value} alt="Your store logo" /></div>
          <InlineStack gap="200">
            <Button onClick={() => setDialog(true)} loading={busy}>Replace</Button>
            <Button tone="critical" variant="plain" onClick={() => { onChange(''); setUrl(''); }}>Remove</Button>
          </InlineStack>
          <div style={{ display: 'none' }}>
            <DropZone accept={ACCEPT} type="image" allowMultiple={false} openFileDialog={dialog} onFileDialogClose={() => setDialog(false)} onDrop={onDrop} />
          </div>
        </div>
      ) : (
        <div className="cod-logo-drop">
          <DropZone accept={ACCEPT} type="image" allowMultiple={false} onDrop={onDrop} label="Store logo" labelHidden>
            <DropZone.FileUpload actionTitle={busy ? 'Preparing…' : 'Upload logo'} actionHint="PNG, JPG, WebP or SVG. We resize it for you." />
          </DropZone>
        </div>
      )}
      <InlineStack gap="200" blockAlign="end" wrap={false}>
        <div style={{ flex: 1 }}>
          <TextField label="Or use an image link" value={url} onChange={setUrl} placeholder="https://cdn.shopify.com/…/logo.png" autoComplete="off" />
        </div>
        <Button onClick={applyUrl} disabled={!url.trim() || url.trim() === value}>Use link</Button>
      </InlineStack>
      {(problem || error) && <InlineError message={problem || error} fieldID="cod-logo" />}
      <Text as="p" variant="bodySm" tone="subdued">Shown on the left of the popup header. A wide logo on a transparent background looks best.</Text>
    </BlockStack>
  );
}
