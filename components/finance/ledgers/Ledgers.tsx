import React, { useState } from 'react';
import { Button } from '../../ui/Button';
import { useQueryParam } from '../../../hooks/useQueryParam';
import { ArrowPathIcon, ArrowLeftIcon } from '../../icons/Icons';
import { CnfLedgerView } from '../../logistics/cnf/CnfLedgerView';
import { PartyLedgersList } from './PartyLedgersList';
import { PartnerLedgerView } from './PartnerLedgerView';

// Ledgers of every party that gives us a tax invoice: KREIZ (CNF) and the air
// shipping partners — see docs/superpowers/specs/2026-09-29-air-shipping-partner-design.md.
// ?party=<id> opens one party's ledger; KREIZ's is the CNF Ledger itself.
export const Ledgers: React.FC = () => {
  const [party, setParty] = useQueryParam<string>('party', '');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-white">Ledgers</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Every party that gives us a tax invoice: KREIZ and the air shipping partners.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setRefreshKey(k => k + 1)} icon={<ArrowPathIcon className="w-4 h-4" />}>
          Refresh Data
        </Button>
      </div>
      {party && (
        <button onClick={() => setParty('')} className="flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
          <ArrowLeftIcon className="w-4 h-4" />All ledgers
        </button>
      )}
      {!party ? (
        <PartyLedgersList refreshKey={refreshKey} onOpen={setParty} />
      ) : party === 'KREIZ' ? (
        <CnfLedgerView refreshKey={refreshKey} />
      ) : (
        <PartnerLedgerView partnerId={party} refreshKey={refreshKey} />
      )}
    </div>
  );
};
