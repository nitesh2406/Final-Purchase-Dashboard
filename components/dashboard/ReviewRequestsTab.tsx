import React, { useState, useEffect, useCallback } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../constants';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
  CheckBadgeIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '../icons/Icons';

// ─────────────────────────────────────────
// Review Requests — admin-only subtab of Update SKU. Lists Factory Code /
// RMB Price / EAN correction requests raised on the Vendor Shipment
// "ID / Price / EAN Review" step (writeFieldUpdateRequests_ in
// AppBuilding/11_PO+Shipment Codes.gs), now queued in SKU_Update_Requests
// instead of applying to EasyEcom immediately. Approving here re-validates
// against live master data and pushes via the existing updateCustomFieldsSmart
// (apiResolveSkuUpdateRequest in AppBuilding/18_newskuapi.gs).
// ─────────────────────────────────────────

type ReqStatus = 'PENDING' | 'REJECTED' | 'SYNCED' | 'FAILED';

interface SkuUpdateRequest {
  request_id: string;
  shipment_id: string;
  vendor_code: string;
  target_sku: string;
  item_name: string;
  color: string;
  my_id: string;
  proposed_factory_code: string;
  proposed_ean: string;
  proposed_unit_price: number;
  master_factory_code_snapshot: string;
  master_ean_snapshot: string;
  master_unit_price_snapshot: number;
  current_master_factory_code: string;
  current_master_ean: string;
  current_master_unit_price: number;
  status: ReqStatus;
  requested_by: string;
  requested_at: string;
  resolved_by: string;
  resolved_at: string;
  sync_notes: string;
}

const STATUS_LABELS: Record<ReqStatus, string> = {
  PENDING: 'Pending', REJECTED: 'Rejected', SYNCED: 'Synced', FAILED: 'Failed',
};

const formatTimestamp = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const FieldDiff: React.FC<{ label: string; current: string | number; proposed: string | number }> = ({ label, current, proposed }) => {
  if (!proposed && proposed !== 0) return null;
  const changed = String(current ?? '') !== String(proposed ?? '');
  return (
    <div className="py-1">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 dark:text-gray-400 font-mono">{current || '—'}</span>
        <span className="text-gray-300 dark:text-gray-600">→</span>
        <span className={`font-mono font-semibold ${changed ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>{proposed}</span>
      </div>
    </div>
  );
};

export const ReviewRequestsTab: React.FC = () => {
  const [status, setStatus] = useState<ReqStatus>('PENDING');
  const [rows, setRows] = useState<SkuUpdateRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resultNote, setResultNote] = useState<{ request_id: string; status: string; sync_notes: string } | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: API_ACTIONS.GET_PENDING_SKU_UPDATE_REQUESTS, status })
      });
      const result = await response.json();
      if (result.success) {
        setRows(result.data || []);
      } else {
        setFetchError(result.error || 'Failed to load requests');
      }
    } catch (err) {
      setFetchError('Network error while loading requests');
      console.error('fetchRequests error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const resolve = async (requestId: string, decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'APPROVE' && !window.confirm('Approving pushes this change live to EasyEcom. Continue?')) return;
    setResolvingId(requestId);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: API_ACTIONS.RESOLVE_SKU_UPDATE_REQUEST,
          request_id: requestId,
          decision,
          resolved_by: 'user',
        })
      });
      const result = await response.json();
      if (result.success) {
        setResultNote(result.data);
        setRows(prev => prev.filter(r => r.request_id !== requestId));
      } else {
        alert('Failed to resolve request: ' + result.error);
      }
    } catch (err) {
      alert('Network error while resolving request');
      console.error('resolve error:', err);
    } finally {
      setResolvingId(null);
    }
  };

  const statuses: ReqStatus[] = ['PENDING', 'REJECTED', 'SYNCED', 'FAILED'];

  return (
    <div className="space-y-4">
      <Card className="!p-4">
        <div className="flex flex-wrap gap-2">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all ${
                status === s
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </Card>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading requests...</div>
      ) : fetchError ? (
        <div className="py-16 text-center">
          <ExclamationTriangleIcon className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-red-500">{fetchError}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No {STATUS_LABELS[status].toLowerCase()} requests</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <Card key={r.request_id} className="!p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{r.target_sku}</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{r.item_name}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-2">
                    Shipment {r.shipment_id} · Vendor {r.vendor_code} · Requested by {r.requested_by} on {formatTimestamp(r.requested_at)}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FieldDiff label="Factory Code" current={r.current_master_factory_code} proposed={r.proposed_factory_code} />
                    <FieldDiff label="EAN" current={r.current_master_ean} proposed={r.proposed_ean} />
                    <FieldDiff label="RMB Price" current={r.current_master_unit_price} proposed={r.proposed_unit_price} />
                  </div>

                  {status !== 'PENDING' && (
                    <div className="mt-2 flex items-center gap-2">
                      {r.status === 'SYNCED' && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                          <CheckBadgeIcon className="w-4 h-4" /> Synced
                        </span>
                      )}
                      {r.status === 'FAILED' && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                          <XMarkIcon className="w-4 h-4" /> Failed
                        </span>
                      )}
                      {r.status === 'REJECTED' && (
                        <span className="text-xs font-semibold text-gray-400">Rejected</span>
                      )}
                      {r.sync_notes && <span className="text-[11px] text-gray-400">{r.sync_notes}</span>}
                      {(r.resolved_by || r.resolved_at) && (
                        <span className="text-[11px] text-gray-400">
                          by {r.resolved_by || '—'} on {formatTimestamp(r.resolved_at)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {status === 'PENDING' && (
                  <div className="flex flex-col gap-2 shrink-0 w-36">
                    <Button
                      variant="primary"
                      className="text-xs"
                      disabled={resolvingId === r.request_id}
                      onClick={() => resolve(r.request_id, 'APPROVE')}
                    >
                      {resolvingId === r.request_id ? 'Working...' : 'Approve'}
                    </Button>
                    <Button
                      variant="secondary"
                      className="text-xs"
                      disabled={resolvingId === r.request_id}
                      onClick={() => resolve(r.request_id, 'REJECT')}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {resultNote && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={() => setResultNote(null)}
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">
              {resultNote.status === 'SYNCED' ? 'Synced to EasyEcom' : resultNote.status === 'REJECTED' ? 'Request rejected' : 'Failed'}
            </h3>
            {resultNote.sync_notes && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{resultNote.sync_notes}</p>}
            <Button variant="secondary" className="w-full text-xs" onClick={() => setResultNote(null)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
};
