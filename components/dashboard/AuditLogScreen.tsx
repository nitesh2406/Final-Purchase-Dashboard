import React, { useState, useEffect, useCallback } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../constants';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
  MagnifyingGlassIcon,
  CheckBadgeIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '../icons/Icons';

// ─────────────────────────────────────────
// Audit Log — one shared, filterable log of every change that touches
// EasyEcom, Zoho, Shopify, or the internal Purchase Order system. See
// logAuditEvent_ / apiGetAuditLog in AppBuilding/18_newskuapi.gs for the
// backend side. "Identifier Removal" is a defined channel with nothing
// feeding it yet — depends on the not-yet-built Sample SKU feature.
// ─────────────────────────────────────────

type Channel = 'ALL' | 'EASYECOM' | 'ZOHO' | 'SHOPIFY' | 'PURCHASE_ORDER' | 'IDENTIFIER_REMOVAL';

interface AuditLogRow {
  timestamp: string;
  channel: Exclude<Channel, 'ALL'>;
  action: string;
  entity_id: string;
  summary: string;
  status: 'SUCCESS' | 'FAILED' | string;
  actor: string;
  request_id: string;
}

const CHANNEL_LABELS: Record<Channel, string> = {
  ALL: 'All',
  EASYECOM: 'EasyEcom',
  ZOHO: 'Zoho',
  SHOPIFY: 'Shopify',
  PURCHASE_ORDER: 'Purchase Order',
  IDENTIFIER_REMOVAL: 'Identifier Removal',
};

const CHANNEL_BADGE_CLASSES: Record<Exclude<Channel, 'ALL'>, string> = {
  EASYECOM: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ZOHO: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  SHOPIFY: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  PURCHASE_ORDER: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  IDENTIFIER_REMOVAL: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400',
};

const formatTimestamp = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

export const AuditLogScreen: React.FC<{
  onOpenUpdateSku?: (sku: string) => void;
}> = ({ onOpenUpdateSku }) => {
  const [channel, setChannel] = useState<Channel>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    if (channel === 'IDENTIFIER_REMOVAL') {
      setRows([]);
      return;
    }
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: API_ACTIONS.GET_AUDIT_LOG,
          channel: channel === 'ALL' ? undefined : channel,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          search: search.trim() || undefined,
        })
      });
      const result = await response.json();
      if (result.success) {
        setRows(result.data || []);
      } else {
        setFetchError(result.error || 'Failed to load audit log');
      }
    } catch (err) {
      setFetchError('Network error while loading audit log');
      console.error('fetchLog error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [channel, dateFrom, dateTo, search]);

  useEffect(() => {
    fetchLog();
  }, [channel, dateFrom, dateTo]);

  const channels: Channel[] = ['ALL', 'EASYECOM', 'ZOHO', 'SHOPIFY', 'PURCHASE_ORDER', 'IDENTIFIER_REMOVAL'];

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-4 animate-in fade-in duration-500">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Audit Log</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        Every change that touches EasyEcom, Zoho, Shopify, or the internal Purchase Order system.
      </p>

      {/* Filter bar */}
      <Card className="!p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {channels.map(c => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all ${
                channel === c
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="h-9 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-9 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') fetchLog(); }}
              placeholder="Search by SKU, PO ID, or request ID..."
              className="h-9 w-full pl-8 pr-3 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <Button variant="secondary" onClick={fetchLog} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
      </Card>

      {/* Results */}
      <Card className="!p-0 overflow-hidden">
        {channel === 'IDENTIFIER_REMOVAL' ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No events yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Identifier Removal events depend on the Sample SKU feature, which hasn't been built yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[160px]">Timestamp</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[120px]">Channel</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[100px]">Action</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[140px]">Entity</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Summary</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center w-[100px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6}>
                    <div className="py-16 text-center">
                      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">Loading audit log...</p>
                    </div>
                  </td></tr>
                ) : fetchError ? (
                  <tr><td colSpan={6}>
                    <div className="py-16 text-center">
                      <ExclamationTriangleIcon className="w-8 h-8 text-red-400 mx-auto mb-3" />
                      <p className="text-sm font-medium text-red-500">{fetchError}</p>
                    </div>
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6}>
                    <div className="py-16 text-center">
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No events found</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try adjusting your filters</p>
                    </div>
                  </td></tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${
                        r.request_id && onOpenUpdateSku ? 'cursor-pointer' : ''
                      }`}
                      onClick={() => {
                        if (r.request_id && onOpenUpdateSku) onOpenUpdateSku(r.entity_id || r.request_id);
                      }}
                    >
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatTimestamp(r.timestamp)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CHANNEL_BADGE_CLASSES[r.channel] || CHANNEL_BADGE_CLASSES.IDENTIFIER_REMOVAL}`}>
                          {CHANNEL_LABELS[r.channel] || r.channel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-gray-700 dark:text-gray-300">{r.action}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-700 dark:text-gray-300">{r.entity_id || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">{r.summary}</td>
                      <td className="px-4 py-3 text-center">
                        {r.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            <CheckBadgeIcon className="w-4 h-4" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                            <XMarkIcon className="w-4 h-4" /> Failed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
