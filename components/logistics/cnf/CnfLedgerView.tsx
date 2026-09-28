import React, { useEffect, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { invalidateReadCache } from '../../../services/gasApi';
import { fetchCnfLedgerStatement } from '../../../services/cnfService';
import type { CnfLedgerStatement } from '../../../types';
import { fmtInr } from './cnfFormat';

const csvCell = (v: string | number | null) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CnfLedgerView: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statement, setStatement] = useState<CnfLedgerStatement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async (force: boolean) => {
    if (force) invalidateReadCache();
    setIsLoading(true);
    setLoadError(null);
    try {
      setStatement(await fetchCnfLedgerStatement({ from, to }));
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load the CNF ledger');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(refreshKey > 0); }, [refreshKey, from, to]);

  const exportCsv = () => {
    if (!statement) return;
    const lines = [['Date', 'Type', 'Reference', 'Description', 'Paid to CNF', 'Billed by CNF', 'Balance', 'Open advance'].join(',')];
    lines.push(['', 'Opening balance', '', '', '', '', statement.openingBalance, ''].map(csvCell).join(','));
    statement.rows.forEach(r => lines.push([r.date, r.type, r.reference, r.description, r.paid || '', r.billed || '', r.balance, r.openAdvance ?? ''].map(csvCell).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cnf-ledger${from ? '-from-' + from : ''}${to ? '-to-' + to : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dateInput = 'px-3 py-1.5 border rounded-lg text-xs bg-white dark:bg-slate-900';

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => load(true)}>Retry</Button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-3 items-end">
          <label className="text-xs text-slate-500">From<br /><input type="date" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} className={dateInput} /></label>
          <label className="text-xs text-slate-500">To<br /><input type="date" aria-label="To" value={to} onChange={e => setTo(e.target.value)} className={dateInput} /></label>
          {(from || to) && <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => { setFrom(''); setTo(''); }}>Clear</Button>}
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!statement}>Export CSV</Button>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">CNF Ledger</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Paid to CNF: direct payments for overseas vendors and payments to CNF (KREIZ). Billed by CNF: approved CNF tax invoices. Positive balance = CNF holds our money.
            </p>
          </div>
          {statement && (
            <div className="text-right text-sm" data-testid="cnf-ledger-closing">
              <span className="text-slate-400 text-xs block">Closing balance</span>
              <span className="font-mono font-semibold">{fmtInr(statement.closingBalance)}</span>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Paid to CNF</th>
                <th className="px-4 py-3 text-right">Billed by CNF</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Open Advance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && !statement ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : !statement ? null : (
                <>
                  <tr className="bg-slate-50/50 dark:bg-slate-900/50">
                    <td className="px-4 py-2 text-xs text-slate-400" colSpan={5}>Opening balance{from ? ` before ${from}` : ''}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtInr(statement.openingBalance)}</td>
                    <td />
                  </tr>
                  {statement.rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No entries in this range.</td></tr>
                  ) : statement.rows.map((r, i) => (
                    <tr key={`${r.reference}-${i}`}>
                      <td className="px-4 py-3 whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.type}</td>
                      <td className="px-4 py-3 text-xs">{r.description}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.paid ? fmtInr(r.paid) : ''}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.billed ? fmtInr(r.billed) : ''}</td>
                      <td className={`px-4 py-3 text-right font-mono ${r.balance < 0 ? 'text-red-500' : ''}`}>{fmtInr(r.balance)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">{r.openAdvance != null ? fmtInr(r.openAdvance) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-4 py-3" colSpan={3}>Totals</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtInr(statement.totals.paid)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtInr(statement.totals.billed)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtInr(statement.closingBalance)}</td>
                    <td />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
