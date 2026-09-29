import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { useQueryParam } from '../../hooks/useQueryParam';
import { ArrowPathIcon, ListBulletIcon, DocumentTextIcon, CreditCardIcon } from '../icons/Icons';
import { CnfBatchesView } from './cnf/CnfBatchesView';
import { CnfInvoicesView } from './cnf/CnfInvoicesView';
import { CnfLedgerView } from './cnf/CnfLedgerView';

// One CNF tab — see docs/superpowers/specs/2026-09-28-cnf-unified-tab-design.md.
// Replaces the old Batch Overview / Bill Reconciliation tabs and the separate
// CNF Advances screen.
type CnfTab = 'batches' | 'invoices' | 'ledger';

export const CnfAgentAccounting: React.FC = () => {
  const [rawTab, setTab] = useQueryParam<string>('cnfTab', 'batches');
  // Old links carry the retired 'overview' / 'reconciliation' values.
  const tab: CnfTab = rawTab === 'invoices' || rawTab === 'ledger' ? rawTab : 'batches';
  const [refreshKey, setRefreshKey] = useState(0);
  // Each view loads its data when it mounts, so unmounting it on every tab
  // switch reloaded it each time. A view is mounted on first visit and then
  // only hidden; Refresh Data reloads every mounted view.
  const [visited, setVisited] = useState<ReadonlySet<CnfTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
  const pane = (t: CnfTab, view: React.ReactNode) =>
    visited.has(t) ? <div className={tab === t ? undefined : 'hidden'}>{view}</div> : null;
  // A write on one sub-tab (log / approve / reject an invoice, save a draft)
  // changes what the others show; the hidden ones stay mounted, so reload
  // every mounted view — the same as Refresh Data.
  const onDataChanged = () => setRefreshKey(k => k + 1);

  const tabClass = (t: CnfTab) =>
    `flex-1 md:flex-initial min-w-[160px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
      tab === t
        ? 'bg-primary-600 text-white shadow-md'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
    }`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-white">CNF Agent</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Batches paid through CNF, CNF's tax invoices against them, and the running balance with CNF.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setRefreshKey(k => k + 1)} icon={<ArrowPathIcon className="w-4 h-4" />}>
          Refresh Data
        </Button>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-750 bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-xl gap-1 max-w-full overflow-x-auto shadow-sm">
        <button onClick={() => setTab('batches')} className={tabClass('batches')}><ListBulletIcon className="w-4 h-4" /><span>Batches</span></button>
        <button onClick={() => setTab('invoices')} className={tabClass('invoices')}><DocumentTextIcon className="w-4 h-4" /><span>CNF Invoices</span></button>
        <button onClick={() => setTab('ledger')} className={tabClass('ledger')}><CreditCardIcon className="w-4 h-4" /><span>CNF Ledger</span></button>
      </div>

      {pane('batches', <CnfBatchesView refreshKey={refreshKey} onDataChanged={onDataChanged} />)}
      {pane('invoices', <CnfInvoicesView refreshKey={refreshKey} onDataChanged={onDataChanged} />)}
      {pane('ledger', <CnfLedgerView refreshKey={refreshKey} />)}
    </div>
  );
};
