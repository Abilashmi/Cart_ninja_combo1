// Small controls and mini pictures for the Coupon Banner editor. Styles are
// the cbz- classes in ./styles.js.
import { useId, useState } from "react";
import { Icon } from "@shopify/polaris";
import { ChevronDownIcon } from "@shopify/polaris-icons";

/**
 * Settings folded away under a title (closed until clicked). Pass open +
 * onToggle(next) to open it from outside (e.g. when its feature is switched on).
 */
export function Fold({ title, description, children, open: openProp, onToggle }) {
    const id = useId();
    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const toggle = () => (onToggle ? onToggle(!open) : setOpenState((o) => !o));
    return (
        <div className={`cbz-fold${open ? " is-open" : ""}`}>
            <button type="button" className="cbz-fold-h" aria-expanded={open} aria-controls={id} onClick={toggle}>
                <span>
                    <span className="cbz-fold-t">{title}</span>
                    {description && <span className="cbz-fold-d">{description}</span>}
                </span>
                <span className="cbz-chev"><Icon source={ChevronDownIcon} /></span>
            </button>
            {open && <div className="cbz-fold-b" id={id}>{children}</div>}
        </div>
    );
}

// Arrow keys on a radio / tab move the choice within its group (focus follows).
function moveWithArrows(e, values, value, onChange) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = Math.max(0, values.indexOf(value));
    const next = values[(i + step + values.length) % values.length];
    onChange(next);
    const group = e.currentTarget.parentElement;
    const el = group && group.querySelector(`[data-value="${CSS.escape(String(next))}"]`);
    if (el) el.focus();
}

/** One choice out of a few short options, drawn as a segmented bar. */
export function Segmented({ label, value, options, onChange, helpText }) {
    const id = useId();
    const values = options.map((o) => o.value);
    const current = values.includes(value) ? value : values[0];
    return (
        <div>
            <span className="cbz-label" id={id}>{label}</span>
            <div className="cbz-seg" role="radiogroup" aria-labelledby={id}>
                {options.map((o) => {
                    const on = o.value === current;
                    return (
                        <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-value={o.value}
                            className={on ? "is-on" : undefined} onClick={() => onChange(o.value)} onKeyDown={(e) => moveWithArrows(e, values, current, onChange)}>
                            {o.label}
                        </button>
                    );
                })}
            </div>
            {helpText && <div className="cbz-help">{helpText}</div>}
        </div>
    );
}

/** One choice out of a few options, each a tile with a small picture. options = [{ value, label, description, art }]. */
export function ChoiceTiles({ label, labelHidden = false, value, options, onChange, columns = 3, helpText }) {
    const id = useId();
    const values = options.map((o) => o.value);
    return (
        <div>
            {label && !labelHidden && <span className="cbz-label" id={id}>{label}</span>}
            <div className="cbz-tiles" role="radiogroup" aria-labelledby={label && !labelHidden ? id : undefined} aria-label={labelHidden ? label : undefined}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {options.map((o) => {
                    const on = o.value === value;
                    return (
                        <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.label}
                            aria-describedby={o.description ? `${id}-${o.value}` : undefined}
                            tabIndex={on || (!values.includes(value) && o.value === values[0]) ? 0 : -1} data-value={o.value}
                            className={`cbz-tile${on ? " is-on" : ""}`} onClick={() => onChange(o.value)} onKeyDown={(e) => moveWithArrows(e, values, value, onChange)}>
                            {o.art && <span className="cbz-tile-art" aria-hidden="true">{o.art}</span>}
                            <span className="cbz-tile-l">{o.label}</span>
                            {o.description && <span className="cbz-tile-d" id={`${id}-${o.value}`}>{o.description}</span>}
                            {on && <span className="cbz-tile-check" aria-hidden="true">✓</span>}
                        </button>
                    );
                })}
            </div>
            {helpText && <div className="cbz-help">{helpText}</div>}
        </div>
    );
}

/* ─── mini pictures (decorative, aria-hidden by the tile) ─────────────────── */
const line = (w, color, h = 4) => <i style={{ display: "block", width: w, height: h, borderRadius: 2, background: color }} />;
const col = (children, gap = 3) => <span style={{ display: "flex", flexDirection: "column", gap, minWidth: 0, flex: 1 }}>{children}</span>;
const box = (style, children) => <span style={{ display: "flex", alignItems: "center", gap: 6, boxSizing: "border-box", ...style }}>{children}</span>;

/** The three card designs, in their default colours. */
export function TemplateArt({ id }) {
    if (id === "minimal-card") {
        return box({ width: "100%", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 5, padding: 5 }, <>
            <span style={{ width: 26, height: 26, border: "1px dashed #10b981", background: "#10b98118", borderRadius: 3, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>{line(14, "#10b981", 3)}</span>
            {col(<>{line("70%", "#374151")}{line("50%", "#9ca3af", 3)}<i style={{ display: "block", width: 22, height: 6, borderRadius: 2, background: "#10b981" }} /></>)}
        </>);
    }
    if (id === "bold-vibrant") {
        return box({ width: "100%", background: "#000", borderRadius: 7, padding: 6 }, <>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: "#f59e0b55", flex: "none" }} />
            {col(<>{line("70%", "#fff")}{line("55%", "#ffffffaa", 3)}
                <span style={{ display: "flex", gap: 3 }}><i style={{ display: "block", flex: 1, height: 7, border: "1px dashed #f59e0b", borderRadius: 2 }} /><i style={{ display: "block", width: 16, height: 9, borderRadius: 2, background: "#f59e0b" }} /></span></>)}
        </>);
    }
    return box({ width: "100%", background: "#fff", border: "1px solid #e5e7eb", borderLeft: "3px solid #3b82f6", borderRadius: 5, padding: "8px 6px" }, <>
        {col(<>{line("75%", "#111827")}{line("55%", "#9ca3af", 3)}</>)}
        <i style={{ display: "block", width: 26, height: 10, borderRadius: 3, background: "#3b82f6", flex: "none" }} />
    </>);
}

/** What each kind of offer looks like on the banner. */
export function OfferArt({ kind }) {
    if (kind === "ladder") {
        return box({ width: "100%", background: "#111827", borderRadius: 4, padding: "6px 5px", justifyContent: "center", gap: 4 }, <>
            {line(14, "#fff", 3)}<i style={{ display: "block", width: 1, height: 8, background: "#ffffff66" }} />{line(14, "#fff", 3)}
        </>);
    }
    if (kind === "text") {
        return box({ width: "100%", background: "#fff", border: "1px solid #c7d2fe", borderRadius: 4, padding: 5 }, col(<>{line("80%", "#4338ca", 3)}{line("55%", "#a5b4fc", 3)}</>, 3));
    }
    return box({ width: "100%", background: "#fff", border: "1px solid #e5e7eb", borderLeft: `3px solid ${kind === "custom" ? "#22a06b" : "#3b82f6"}`, borderRadius: 4, padding: "5px 4px" }, <>
        {col(<>{line("85%", "#111827", 3)}{line("60%", "#9ca3af", 2)}</>, 3)}
        <i style={{ display: "block", width: 12, height: 7, borderRadius: 2, flex: "none", background: kind === "custom" ? "#22a06b" : "#3b82f6" }} />
    </>);
}

/** List / carousel / grid. */
export function ArrangeArt({ layout }) {
    const card = (key, style) => <i key={key} style={{ display: "block", height: 12, borderRadius: 3, background: "#fff", border: "1px solid #c9cccf", borderLeft: "3px solid #3b82f6", boxSizing: "border-box", ...style }} />;
    if (layout === "grid") {
        return <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, width: "80%" }}>{[0, 1, 2, 3].map((k) => card(k))}</span>;
    }
    if (layout === "carousel") {
        return (
            <span style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
                <span style={{ fontSize: 10, color: "#8c9196" }}>‹</span>
                {card(0, { flex: "0 0 38%", height: 26 })}{card(1, { flex: "0 0 38%", height: 26 })}{card(2, { flex: "1 0 0", height: 26, opacity: 0.5 })}
                <span style={{ fontSize: 10, color: "#8c9196" }}>›</span>
            </span>
        );
    }
    return <span style={{ display: "flex", flexDirection: "column", gap: 4, width: "80%" }}>{[0, 1, 2].map((k) => card(k, { height: 9 }))}</span>;
}
