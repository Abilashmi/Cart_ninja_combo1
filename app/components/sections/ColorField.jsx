import React from 'react';
import { TextField } from '@shopify/polaris';

export function ColorField({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        autoComplete="off"
        prefix={
          <div style={{ position: 'relative' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                backgroundColor: value,
                border: '1px solid #c9cccf',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{
                  opacity: 0,
                  width: '100%',
                  height: '100%',
                  cursor: 'pointer',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                }}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
