// Coupon Banner → "1. Coupons to show": a tick box per code (and per text
// offer / offer ladder added under More options); a ticked one gets an Edit
// button that opens its popup (OfferEditModal). State lives in
// app.productwidget.jsx.
import { useState } from "react";
import { BlockStack, InlineStack, Text, TextField, Button } from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";

/** rows = every offer that can be shown, in list order: [{ id, title, sub }]. */
export function CouponPicker({ rows, selectedIds, onToggle, onEdit, onAddCustom }) {
    const [search, setSearch] = useState("");
    const q = search.trim().toLowerCase();
    const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q) || (r.sub || "").toLowerCase().includes(q));
    const count = rows.filter((r) => selectedIds.includes(r.id)).length;
    return (
        <BlockStack gap="200">
            {rows.length > 6 && (
                <TextField label="Search codes" labelHidden placeholder="Search codes…" value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />
            )}
            {rows.length === 0 ? (
                <div className="cbz-empty">No active discount codes yet. Create one in <b>Discount Creator</b>, or add a code you made in another app.</div>
            ) : (
                <div className="cbz-clist">
                    {shown.length === 0 && <div className="cbz-clist-none">No codes match your search.</div>}
                    {shown.map((r) => {
                        const on = selectedIds.includes(r.id);
                        return (
                            <div key={r.id} className={`cbz-crow${on ? " is-on" : ""}`} data-offer={r.id}>
                                <label className="cbz-crow-main">
                                    <input type="checkbox" checked={on} onChange={() => onToggle(r.id)} />
                                    <span className="cbz-crow-txt">
                                        <span className="cbz-crow-t" title={r.title}>{r.title}</span>
                                        {r.sub && <span className="cbz-crow-s">{r.sub}</span>}
                                    </span>
                                </label>
                                {on && <Button size="slim" onClick={() => onEdit(r.id)} accessibilityLabel={`Edit ${r.title}`}>Edit</Button>}
                            </div>
                        );
                    })}
                </div>
            )}
            <InlineStack align="space-between" blockAlign="center" gap="200">
                <Button variant="plain" icon={PlusIcon} onClick={onAddCustom}>Add a code from another app</Button>
                <Text as="span" variant="bodySm" tone="subdued">{count ? `${count} shown on your banner` : "None shown yet"}</Text>
            </InlineStack>
        </BlockStack>
    );
}
