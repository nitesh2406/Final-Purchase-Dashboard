import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { PencilIcon, PlusIcon } from '../../icons/Icons';
import { invalidateReadCache } from '../../../services/gasApi';
import { fetchPartyLedgers } from '../../../services/shippingPartnerService';
import type { PartyLedgerSummary } from '../../../types';
import { fmtInr } from '../../logistics/cnf/cnfFormat';
import { readViewCache, writeViewCache } from '../../logistics/cnf/viewCache';
import { ShippingPartnerModal, PartnerFormValues } from './ShippingPartnerModal';

const dash = <span className="text-slate-300 dark:text-slate-600">—</span>;

// Every tax-invoice party with its balance; a row click opens its ledger.
export const PartyLedgersList: React.FC<{ refreshKey: number; onOpen: (partyId: string) => void }> = ({ refreshKey, onOpen }) => {
  const [parties, setParties] = useState<PartyLedgerSummary[] | null>(() => readViewCache<PartyLedgerSummary[]>('parties') ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PartnerFormValues | 'new' | null>(null);
  const loadSeq = useRef(0);

  const load = async (force: boolean) => {
    const mine = ++loadSeq.current;
    if (force) invalidateReadCache();
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await fetchPartyLedgers();
      if (mine !== loadSeq.current) return;
      writeViewCache('parties', list);
      setParties(list);
    } catch (err: any) {
      if (mine === loadSeq.current) setLoadError(err.message || 'Failed to load the ledgers');
    } finally {
      if (mine === loadSeq.current) setIsLoading(false);
    }
  };

  useEffect(() => { load(refreshKey > 0); }, [refreshKey]);

  const num = 'px-4 py-3 text-right font-mono';

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}{parties ? ' (showing the last loaded copy)' : ''}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => load(true)}>Retry</Button>
        </div>
      )}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
              Tax-invoice parties
              {isLoading && parties && <span className="ml-2 normal-case tracking-normal font-semibold text-primary-600 animate-pulse">Refreshing…</span>}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Billed: approved tax invoices and bills. Paid includes TDS deducted. Negative balance = we owe the party. Click a row for its ledger.
            </p>
          </div>
          <Button onClick={() => setEditing('new')} icon={<PlusIcon className="w-4 h-4" />}>Add shipping partner</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className="px-4 py-3">Party</th>
                <th className="px-4 py-3">GSTIN</th>
                <th className="px-4 py-3 text-right">₹/kg</th>
                <th className="px-4 py-3 text-right">Billed</th>
                <th className="px-4 py-3 text-right">Paid + TDS</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Pending approval</th>
                <th className="px-4 py-3 text-right">Unpaid bills</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && !parties ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : !parties ? null : parties.map(p => (
                <tr key={p.partyId} data-testid={`party-row-${p.partyId}`} onClick={() => onOpen(p.partyId)}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      {p.kind === 'cnf' ? 'CNF agent' : 'Shipping partner'}{!p.active && ' · inactive'}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.gstin || dash}</td>
                  <td className={num}>{p.ratePerKg != null ? fmtInr(p.ratePerKg) : dash}</td>
                  {p.error ? (
                    <td colSpan={5} className="px-4 py-3 text-xs text-red-500">
                      Couldn't load: {p.error}
                      <button className="ml-2 font-bold underline" onClick={e => { e.stopPropagation(); load(true); }}>Retry</button>
                    </td>
                  ) : (
                    <>
                      <td className={num}>{fmtInr(p.billed ?? 0)}</td>
                      <td className={num}>{fmtInr((p.paid ?? 0) + (p.tds ?? 0))}</td>
                      <td className={`${num} font-semibold ${(p.balance ?? 0) < 0 ? 'text-red-500' : ''}`}>{fmtInr(p.balance ?? 0)}</td>
                      <td className="px-4 py-3 text-right">{p.pendingBills ?? dash}</td>
                      <td className="px-4 py-3 text-right">{p.unpaidBills == null ? dash : p.unpaidBills}</td>
                    </>
                  )}
                  <td className="px-4 py-3 text-right">
                    {p.kind === 'partner' && (
                      <button aria-label={`Edit ${p.name}`} className="text-slate-400 hover:text-primary-600"
                        onClick={e => { e.stopPropagation(); setEditing({ id: p.partyId, name: p.name, gstin: p.gstin, ratePerKg: p.ratePerKg ?? 0, active: p.active }); }}>
                        <PencilIcon className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && (
        <ShippingPartnerModal
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(true); }}
        />
      )}
    </div>
  );
};
