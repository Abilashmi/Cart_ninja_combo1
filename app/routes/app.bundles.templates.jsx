import { useState, useCallback, useMemo } from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import {
  Card, BlockStack, Text, Button, Badge, Icon, Modal,
  InlineGrid, TextField, Select, Toast, Frame,
} from '@shopify/polaris';
import {
  DeleteIcon, DuplicateIcon, EditIcon, SearchIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';

const PRESET_TEMPLATES = [
  {
    id: 'preset-guided',
    name: 'Guided Architect',
    type: 'guided',
    description: 'Step-by-step bundle builder that guides customers through product selection',
    features: ['Multi-step flow', 'Progress indicator', 'Validation rules', 'Completion bonus'],
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    badge: 'Most Popular',
    badgeTone: 'success',
  },
  {
    id: 'preset-grid',
    name: 'Grid Collection',
    type: 'grid',
    description: 'A clean, responsive grid layout showcasing your products with collection filtering',
    features: ['Responsive grid', 'Collection filtering', 'Quick add to cart', 'Price display'],
    gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    badge: 'Classic',
    badgeTone: 'info',
  },
  {
    id: 'preset-velocity',
    name: 'Velocity Stream',
    type: 'carousel',
    description: 'High-velocity carousel built for fast-moving product lines and flash sales',
    features: ['Auto-play slider', 'Touch swipe', 'Countdown timer', 'Flash sale badge'],
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    badge: 'New',
    badgeTone: 'warning',
  },
  {
    id: 'preset-editorial',
    name: 'Editorial Split',
    type: 'editorial',
    description: 'Magazine-style split layout with hero product and supporting items',
    features: ['Hero product spotlight', 'Editorial copy', 'Lifestyle imagery', 'Story-driven'],
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    badge: 'Premium',
    badgeTone: 'attention',
  },
  {
    id: 'preset-premium',
    name: 'Premium Storefront',
    type: 'premium',
    description: 'Full-featured storefront section with banners, AI recommendations, and progress bars',
    features: ['Hero banner', 'AI recommendations', 'Progress bar', 'Custom CSS'],
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    badge: 'Enterprise',
    badgeTone: 'attention',
  },
  {
    id: 'preset-custom',
    name: 'Custom Bundle',
    type: 'custom',
    description: 'Start from scratch with a blank canvas and full design freedom',
    features: ['Blank canvas', 'Full CSS control', 'Custom HTML', 'Advanced theming'],
    gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    badge: 'Flexible',
    badgeTone: 'info',
  },
];

const STATUS_COLORS = {
  active: '#10b981',
  draft: '#f59e0b',
  inactive: '#6b7280',
  published: '#667eea',
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let savedTemplates = [];
  try {
    const { default: prisma } = await import('../db.server');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS combo_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_domain TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        slug TEXT,
        template_type TEXT NOT NULL DEFAULT 'grid',
        status TEXT NOT NULL DEFAULT 'draft',
        is_active INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        features TEXT,
        customization_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC`,
      shop
    );
    savedTemplates = Array.isArray(rows) ? rows : [];
  } catch { /* ignore if table missing */ }

  return { shop, savedTemplates };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get('action');
  const templateId = formData.get('templateId');

  const { default: prisma } = await import('../db.server');

  if (actionType === 'delete' && templateId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?`,
      Number(templateId), shop
    );
    return { success: true, action: 'deleted' };
  }

  if (actionType === 'toggle_status' && templateId) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT status FROM combo_templates WHERE id = ? AND shop_domain = ?`,
      Number(templateId), shop
    );
    const current = Array.isArray(rows) && rows.length > 0 ? rows[0].status : 'draft';
    const next = current === 'active' ? 'draft' : 'active';
    await prisma.$executeRawUnsafe(
      `UPDATE combo_templates SET status = ?, updated_at = datetime('now') WHERE id = ? AND shop_domain = ?`,
      next, Number(templateId), shop
    );
    return { success: true, action: 'toggled', newStatus: next };
  }

  if (actionType === 'duplicate' && templateId) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM combo_templates WHERE id = ? AND shop_domain = ?`,
      Number(templateId), shop
    );
    if (Array.isArray(rows) && rows.length > 0) {
      const src = rows[0];
      const newName = `${src.name} (Copy)`;
      const newSlug = `${src.slug || 'template'}-copy-${Date.now()}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO combo_templates (shop_domain, name, slug, template_type, status, is_active, description, features, customization_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, datetime('now'), datetime('now'))`,
        shop, newName, newSlug, src.template_type, src.description || '', src.features || null, src.customization_data || null
      );
    }
    return { success: true, action: 'duplicated' };
  }

  return { success: false, error: 'Invalid action' };
};

function PresetCard({ template, onUse }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        borderRadius: '12px', overflow: 'hidden',
        border: `1px solid ${hovered ? 'rgba(102,126,234,0.4)' : '#e5e7eb'}`,
        background: '#fff',
        boxShadow: hovered ? '0 8px 24px rgba(102,126,234,0.12)' : '0 1px 3px rgba(0,0,0,0.06)',
        transition: 'all 0.2s ease',
        cursor: 'default',
      }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      {/* Gradient preview area */}
      <div style={{
        height: '110px',
        background: template.gradient,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: '10px', right: '10px',
        }}>
          <Badge tone={template.badgeTone}>{template.badge}</Badge>
        </div>
        <div style={{
          width: '52px', height: '52px', borderRadius: '14px',
          background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '24px', border: '1px solid rgba(255,255,255,0.3)',
        }}>
          ◫
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h3" fontWeight="bold">{template.name}</Text>
          <Text variant="bodyXs" as="p" tone="subdued">{template.description}</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
            {template.features.map(f => (
              <span key={f} style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
                background: '#f3f4f6', color: '#374151', fontWeight: '500',
              }}>{f}</span>
            ))}
          </div>
          <div style={{ marginTop: '4px' }}>
            <Button onClick={() => onUse(template)} variant="primary" fullWidth>
              Use This Template
            </Button>
          </div>
        </BlockStack>
      </div>
    </div>
  );
}

export default function AppBundlesTemplates() {
  const { savedTemplates } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteModal, setDeleteModal] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastActive, setToastActive] = useState(false);

  const showToast = useCallback((msg) => { setToastMsg(msg); setToastActive(true); }, []);

  const handleUseTemplate = useCallback((template) => {
    navigate(`/app/bundles/customize?template=${template.type}`);
  }, [navigate]);

  const handleCreateBlank = useCallback(() => navigate('/app/bundles/customize'), [navigate]);

  const handleAction = useCallback((actionType, id) => {
    const fd = new FormData();
    fd.append('action', actionType);
    fd.append('templateId', String(id));
    fetcher.submit(fd, { method: 'POST' });
    if (actionType === 'delete') { setDeleteModal(null); showToast('Template deleted'); }
    else if (actionType === 'duplicate') showToast('Template duplicated');
    else if (actionType === 'toggle_status') showToast('Status updated');
  }, [fetcher, showToast]);

  const filteredTemplates = useMemo(() => {
    return savedTemplates.filter(t => {
      const matchSearch = !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [savedTemplates, searchQuery, statusFilter]);

  return (
    <Frame>
      <BlockStack gap="500">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <BlockStack gap="100">
            <Text variant="heading2xl" as="h1">Template Library</Text>
            <Text variant="bodyMd" as="p" tone="subdued">
              {savedTemplates.length} saved template{savedTemplates.length !== 1 ? 's' : ''} · Choose a preset or create from scratch
            </Text>
          </BlockStack>
          <Button onClick={handleCreateBlank} variant="primary">+ Create Blank Template</Button>
        </div>

        {/* Featured Presets */}
        <Card>
          <BlockStack gap="400">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '6px', height: '20px', borderRadius: '3px',
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
              }} />
              <Text variant="headingMd" as="h2">Featured Templates</Text>
            </div>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {PRESET_TEMPLATES.map(tpl => (
                <PresetCard key={tpl.id} template={tpl} onUse={handleUseTemplate} />
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Saved Templates */}
        <Card>
          <BlockStack gap="400">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '6px', height: '20px', borderRadius: '3px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
              }} />
              <Text variant="headingMd" as="h2">Saved Templates</Text>
            </div>

            {/* Search + Filter */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <TextField
                  label=""
                  placeholder="Search templates..."
                  prefix={<Icon source={SearchIcon} tone="base" />}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => setSearchQuery('')}
                />
              </div>
              <div style={{ width: '160px' }}>
                <Select
                  label=""
                  options={[
                    { label: 'All Statuses', value: 'all' },
                    { label: 'Active', value: 'active' },
                    { label: 'Draft', value: 'draft' },
                    { label: 'Inactive', value: 'inactive' },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
            </div>

            {filteredTemplates.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                background: '#f9fafb', borderRadius: '10px',
                border: '2px dashed #e5e7eb',
              }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>◫</div>
                <Text variant="headingMd" as="p">
                  {savedTemplates.length === 0 ? 'No saved templates yet' : 'No templates match your search'}
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued" style={{ marginTop: '6px' }}>
                  {savedTemplates.length === 0
                    ? 'Choose a preset above or create a blank template to get started'
                    : 'Try adjusting your search or filter'}
                </Text>
                {savedTemplates.length === 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <Button onClick={handleCreateBlank} variant="primary">Create Your First Template</Button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                {/* Table header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                  gap: '12px', padding: '10px 16px',
                  background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
                }}>
                  {['Template Name', 'Type', 'Status', 'Version', 'Actions'].map(h => (
                    <Text key={h} variant="bodyXs" as="span" tone="subdued" fontWeight="semibold">
                      {h.toUpperCase()}
                    </Text>
                  ))}
                </div>

                {filteredTemplates.map((tpl, i) => (
                  <div key={tpl.id} style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                    gap: '12px', padding: '14px 16px', alignItems: 'center',
                    borderBottom: i < filteredTemplates.length - 1 ? '1px solid #f3f4f6' : 'none',
                    background: '#fff', transition: 'background 0.1s',
                  }}
                    onMouseOver={e => e.currentTarget.style.background = '#fafafa'}
                    onMouseOut={e => e.currentTarget.style.background = '#fff'}
                  >
                    <BlockStack gap="50">
                      <Text variant="bodySm" as="p" fontWeight="semibold">{tpl.name}</Text>
                      <Text variant="bodyXs" as="p" tone="subdued">{tpl.slug || '—'}</Text>
                    </BlockStack>
                    <Badge>{tpl.template_type}</Badge>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: STATUS_COLORS[tpl.status] || '#6b7280',
                      }} />
                      <Text variant="bodyXs" as="span" style={{ textTransform: 'capitalize' }}>
                        {tpl.status}
                      </Text>
                    </div>
                    <Text variant="bodyXs" as="span" tone="subdued">v{tpl.version}</Text>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap' }}>
                      <Button
                        size="slim"
                        onClick={() => navigate(`/app/bundles/customize?id=${tpl.id}`)}
                        icon={EditIcon}
                      >
                        Edit
                      </Button>
                      <Button
                        size="slim"
                        onClick={() => handleAction('duplicate', tpl.id)}
                        icon={DuplicateIcon}
                        loading={fetcher.state !== 'idle'}
                      >
                        Clone
                      </Button>
                      <Button
                        size="slim"
                        onClick={() => handleAction('toggle_status', tpl.id)}
                        variant={tpl.status === 'active' ? 'secondary' : 'primary'}
                      >
                        {tpl.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="slim"
                        tone="critical"
                        onClick={() => setDeleteModal(tpl)}
                        icon={DeleteIcon}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </BlockStack>
        </Card>

      </BlockStack>

      {/* Delete Confirm Modal */}
      {deleteModal && (
        <Modal
          open
          onClose={() => setDeleteModal(null)}
          title="Delete Template"
          primaryAction={{
            content: 'Delete Permanently',
            destructive: true,
            onAction: () => handleAction('delete', deleteModal.id),
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setDeleteModal(null) }]}
        >
          <Modal.Section>
            <Text as="p">
              Are you sure you want to delete <strong>"{deleteModal.name}"</strong>?
              This action cannot be undone and will remove all associated data.
            </Text>
          </Modal.Section>
        </Modal>
      )}

      {toastActive && (
        <Toast content={toastMsg} onDismiss={() => setToastActive(false)} />
      )}
    </Frame>
  );
}
