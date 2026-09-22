import React from 'react';
import { XCircleIcon, ExclamationTriangleIcon, EnvelopeIcon } from '../../icons/Icons';
import { BarcodeProduct } from '../../../types';

interface DuplicateEanModalProps {
  ean: string;
  products: BarcodeProduct[];
  emailRecipients: string[];
  onClose: () => void;
}

export const DuplicateEanModal: React.FC<DuplicateEanModalProps> = ({ ean, products, emailRecipients, onClose }) => {
  const emailDisplay = emailRecipients.length > 0 ? emailRecipients.join(', ') : 'no recipients configured';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 border border-red-300 dark:border-red-500/40 rounded-2xl p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3 mb-5">
          <div className="bg-red-100 dark:bg-red-500/20 p-2.5 rounded-full shrink-0">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-red-700 dark:text-red-300">Duplicate EAN Detected</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Printing has been blocked automatically</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 transition-colors">
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-red-50 dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-xl p-4 mb-4">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-1">EAN/UPC</span>
          <span className="text-xl font-mono font-bold text-red-600 dark:text-red-300 tracking-wider">{ean}</span>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
            This EAN/UPC is assigned to multiple SKUs. Printing has been blocked.
          </p>
        </div>

        <div className="mb-4">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block mb-2">Affected SKUs</span>
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {products.map((p, i) => (
              <div key={p.sku} className="flex items-start gap-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-400 dark:text-slate-600 font-mono shrink-0 mt-0.5">{i + 1}.</span>
                <div className="min-w-0">
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{p.sku}</span>
                  {p.product_name && <span className="text-[10px] text-slate-500 dark:text-slate-400 block truncate">{p.product_name}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 mb-5 flex items-start gap-2">
          <EnvelopeIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            An escalation email will be sent to <span className="font-semibold">{emailDisplay}</span> at the end of this session.
            Please resolve the product master data before printing.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors text-sm"
        >
          Understood — Close
        </button>
      </div>
    </div>
  );
};
