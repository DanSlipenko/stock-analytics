'use client';

import React, { useState, useCallback, useRef } from 'react';
import { AutoComplete, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { StockSearchResult } from '@/types';

interface SymbolSearchProps {
  onSelect: (symbol: string, description: string) => void;
  placeholder?: string;
  value?: string;
  style?: React.CSSProperties;
}

export default function SymbolSearch({ onSelect, placeholder = 'Search stocks...', value, style }: SymbolSearchProps) {
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode }[]>([]);
  const [inputValue, setInputValue] = useState(value || '');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = useCallback((text: string) => {
    setInputValue(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!text || text.length < 1) {
      setOptions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stock/search?q=${encodeURIComponent(text)}`);
        if (res.ok) {
          const data = await res.json();
          setOptions(
            data.results.map((r: StockSearchResult) => ({
              value: r.symbol,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.displaySymbol}</span>
                    <span style={{ color: '#94a3b8', marginLeft: 8, fontSize: 12 }}>{r.description}</span>
                  </div>
                  <span style={{ color: '#64748b', fontSize: 11 }}>{r.type}</span>
                </div>
              ),
              description: r.description,
            }))
          );
        }
      } catch (e) {
        console.error('Symbol search error:', e);
      }
    }, 300);
  }, []);

  const handleSelect = useCallback(
    (val: string, option: { value: string; label: React.ReactNode; description?: string }) => {
      setInputValue(val);
      onSelect(val, option.description || val);
    },
    [onSelect]
  );

  return (
    <AutoComplete
      options={options}
      onSearch={handleSearch}
      onSelect={handleSelect}
      value={inputValue}
      style={{ width: '100%', ...style }}
      popupMatchSelectWidth={400}
    >
      <Input
        prefix={<SearchOutlined style={{ color: '#64748b' }} />}
        placeholder={placeholder}
        size="large"
        allowClear
      />
    </AutoComplete>
  );
}
