import { createRoot } from 'react-dom/client';
import PackPreview from '../../../app/components/packs/PackPreview.jsx';

// Renders the admin preview with whatever props the test puts on window.__PROPS__.
const props = window.__PROPS__ || {};
createRoot(document.getElementById('root')).render(<div id="preview" style={{ width: props.width || 560 }}><PackPreview currency={{ code: 'INR', locale: 'en-IN' }} {...props} /></div>);
