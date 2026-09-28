import React from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

// Bill submission through this portal belonged to the retired CNF commission-
// bill flow (see docs/superpowers/specs/2026-09-28-cnf-unified-tab-design.md).
// CNF's GST tax invoices are now logged by the accounts team on the CNF Agent tab.
export const CnfAgentPortal: React.FC<{ user: { email: string; name: string }; onLogout: () => void }> = ({ user, onLogout }) => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">CNF Agent Portal</h1>
        <Button variant="secondary" onClick={onLogout}>Log out</Button>
      </div>
      <Card className="p-6 space-y-2">
        <p className="text-sm">Signed in as {user.email}.</p>
        <p className="text-sm text-slate-500">
          Bill submission through this portal has been retired. Please send your GST tax invoices to the accounts team as usual; they are recorded against shipments on our side.
        </p>
      </Card>
    </div>
  </div>
);
