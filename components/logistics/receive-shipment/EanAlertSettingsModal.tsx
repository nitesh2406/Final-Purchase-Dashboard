import React, { useEffect, useRef, useState } from 'react';
import { XMarkIcon, Cog6ToothIcon, EnvelopeIcon } from '../../icons/Icons';
import { Button } from '../../ui/Button';
import { getSessionAuthHeaders } from '../../../services/authToken';

interface EanAlertSettingsModalProps {
  initialEmails: string[];
  onClose: () => void;
  onSaved: (emails: string[]) => void;
}

export const EanAlertSettingsModal: React.FC<EanAlertSettingsModalProps> = ({ initialEmails, onClose, onSaved }) => {
  const [rawInput, setRawInput] = useState(initialEmails.join(', '));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const emails = rawInput.split(',').map(e => e.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/barcode/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getSessionAuthHeaders() },
        body: JSON.stringify({ eanDuplicateEmails: emails }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.saved) throw new Error(data.error || 'Failed to save settings');
      onSaved(emails);
      setSaved(true);
      setTimeout(onClose, 700);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2.5">
            <Cog6ToothIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-bold text-slate-900 dark:text-white tracking-wide uppercase">EAN Alert Settings</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-2">
            <EnvelopeIcon className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Duplicate EAN Email Notifications</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            When a duplicate EAN/UPC is caught mid-scan, an alert email is sent to these addresses at the end of the session. Separate multiple addresses with commas.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Recipients</label>
            <textarea
              ref={inputRef}
              value={rawInput}
              onChange={e => setRawInput(e.target.value)}
              placeholder="e.g. ops@cubelelo.com, warehouse@cubelelo.com"
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 resize-none outline-none transition"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Shared across all sessions. Leave empty to disable alert emails.</p>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
};
