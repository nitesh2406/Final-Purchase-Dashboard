import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { GenerateBillModal } from './CnfAgentAccounting';
import { fetchCnfLedgerEntries, fetchCnfInvoiceBatches } from '../../services/settlementService';
import { CnfLedgerEntry, CnfInvoiceBatch } from '../../types';

interface CnfAgentPortalProps {
  user: { email: string; name: string };
  onLogout: () => void;
}

export const CnfAgentPortal: React.FC<CnfAgentPortalProps> = ({ user, onLogout }) => {
  const [ledgerEntries, setLedgerEntries] = useState<CnfLedgerEntry[]>([]);
  const [invoiceBatches, setInvoiceBatches] = useState<CnfInvoiceBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    const [entries, batches] = await Promise.all([
      fetchCnfLedgerEntries(),
      fetchCnfInvoiceBatches()
    ]);
    setLedgerEntries(entries);
    setInvoiceBatches(batches);
    setIsLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const unbilledEntries = useMemo(() => ledgerEntries.filter(e => !e.invoiceBatchId), [ledgerEntries]);
  const selectedEntries = useMemo(() => unbilledEntries.filter(e => selectedEntryIds.has(e.id)), [unbilledEntries, selectedEntryIds]);
  const selectedTotalPayable = useMemo(() => selectedEntries.reduce((sum, e) => sum + e.totalPayable, 0), [selectedEntries]);

  // Single-agent system for this round (only KREIZ) — every submission history row is
  // "the agent's own" by definition, no per-agent filtering needed yet.
  const submissionHistory = useMemo(
    () => [...invoiceBatches].sort((a, b) => b.billDate.localeCompare(a.billDate)),
    [invoiceBatches]
  );

  const toggleEntrySelection = (id: string) => {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white">
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-lg font-semibold">CNF Agent Portal</h1>
          <p className="text-xs text-slate-500">{user.name} · {user.email}</p>
        </div>
        <Button variant="secondary" onClick={onLogout}>Log out</Button>
      </div>

      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {selectedEntryIds.size > 0 && (
          <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-4 py-3">
            <span className="text-sm">
              {selectedEntryIds.size} shipment{selectedEntryIds.size === 1 ? '' : 's'} selected — running total ₹{selectedTotalPayable.toLocaleString()}
            </span>
            <Button onClick={() => setIsBillModalOpen(true)}>Submit Invoice</Button>
          </div>
        )}

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/40">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Eligible for Billing ({unbilledEntries.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Shipment</th>
                  <th className="px-4 py-3 text-right">Total Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : unbilledEntries.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">Nothing eligible right now.</td></tr>
                ) : unbilledEntries.map(entry => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedEntryIds.has(entry.id)} onChange={() => toggleEntrySelection(entry.id)} />
                    </td>
                    <td className="px-4 py-3 font-mono">{entry.batchId}</td>
                    <td className="px-4 py-3 text-right font-semibold">₹{entry.totalPayable.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/40">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Submission History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                  <th className="px-4 py-3">Bill No</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {submissionHistory.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No submissions yet.</td></tr>
                ) : submissionHistory.map(batch => (
                  <tr key={batch.id}>
                    <td className="px-4 py-3">{batch.billNo}</td>
                    <td className="px-4 py-3">{batch.billDate}</td>
                    <td className="px-4 py-3 text-right">₹{batch.billedAmount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={
                        batch.status === 'Approved' ? 'text-emerald-600' :
                        batch.status === 'Rejected' ? 'text-red-500' : 'text-amber-500'
                      }>
                        {batch.status}
                      </span>
                      {batch.status === 'Rejected' && batch.rejectionReason && (
                        <span className="block text-xs text-slate-400">{batch.rejectionReason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {isBillModalOpen && (
        <GenerateBillModal
          selectedEntries={selectedEntries}
          computedTotal={selectedTotalPayable}
          submittedBy={user.email}
          onClose={() => setIsBillModalOpen(false)}
          onSuccess={() => { setIsBillModalOpen(false); setSelectedEntryIds(new Set()); loadAll(); }}
        />
      )}
    </div>
  );
};
