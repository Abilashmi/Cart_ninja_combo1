import { createRoot } from 'react-dom/client';
import PackPreview from '../../../app/components/packs/PackPreview.jsx';

// Renders the admin preview with whatever props the test puts on window.__PROPS__.
const props = window.__PROPS__ || {};
const formatMoney = (value) => `₹${Number(value).toFixed(2)}`;
createRoot(document.getElementById('root')).render(<div id="preview" style={{ width: 560 }}><PackPreview {...props} formatMoney={formatMoney} /></div>);
