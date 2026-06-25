import React, { useState, useMemo } from 'react';
import { Button } from '../ui/Button';
import { 
    XMarkIcon, PaperAirplaneIcon, CheckBadgeIcon, 
    ExclamationTriangleIcon, LockClosedIcon 
} from '../icons/Icons';

export interface VendorGroupSummary {
    vendorCode: string;
    vendorName: string;
    skuCount: number;
    itemCount: number;
    totalAmount: number;
    hasAllFiles: boolean;
    isLocked?: boolean;
    poRef?: string;
}

interface SelectiveSubmitModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selectedVendors: string[]) => void;
    vendorGroups: VendorGroupSummary[];
}

export const SelectiveSubmitModal: React.FC<SelectiveSubmitModalProps> = ({ 
    isOpen, onClose, onConfirm, vendorGroups 
}) => {
    const activeVendors = useMemo(() => vendorGroups.filter(v => !v.isLocked), [vendorGroups]);
    const submittedVendors = useMemo(() => vendorGroups.filter(v => v.isLocked), [vendorGroups]);

    const [selectedVendorCodes, setSelectedVendorCodes] = useState<string[]>(() => 
        activeVendors.filter(v => v.hasAllFiles).map(v => v.vendorCode)
    );

    const summary = useMemo(() => {
        const selected = activeVendors.filter(v => selectedVendorCodes.includes(v.vendorCode));
        const totalAmount = selected.reduce((sum, v) => sum + v.totalAmount, 0);
        return { count: selected.length, totalAmount };
    }, [selectedVendorCodes, activeVendors]);

    if (!isOpen) return null;

    const toggleVendor = (code: string) => {
        setSelectedVendorCodes(prev => 
            prev.includes(code) ? prev.filter(v => v !== code) : [...prev, code]
        );
    };

    const formatCurrency = (amt: number) => 
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt);

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[120] p-4 animate-in fade-in duration-200">
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl p-6 overflow-hidden animate-in zoom-in-95 duration-200 relative flex flex-col max-h-[85vh]">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
                    <XMarkIcon className="w-5 h-5" />
                </button>

                <h3 className="text-xl font-semibold text-white">Submit Purchase Orders</h3>
                <p className="text-sm text-slate-400 mt-1">Select vendors ready to submit:</p>

                <div className="mt-6 space-y-4 overflow-y-auto pr-2 flex-grow scrollbar-thin">
                    {/* Active Vendors */}
                    <div className="space-y-3">
                        {activeVendors.map((v) => (
                            <div 
                                key={v.vendorCode}
                                onClick={() => toggleVendor(v.vendorCode)}
                                className={`p-4 rounded-lg cursor-pointer border transition-all ${
                                    selectedVendorCodes.includes(v.vendorCode) 
                                        ? 'bg-blue-600/10 border-blue-600/40 shadow-lg shadow-blue-900/10' 
                                        : 'bg-slate-700/20 border-slate-700/50 hover:bg-slate-700/40'
                                }`}
                            >
                                <div className="flex items-center">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedVendorCodes.includes(v.vendorCode)}
                                        readOnly
                                        className="w-5 h-5 accent-blue-600 mr-4 rounded border-slate-600 bg-slate-800"
                                    />
                                    <div>
                                        <span className="text-base font-semibold text-white">{v.vendorName}</span>
                                        <span className="ml-2 text-[10px] font-mono text-slate-500">{v.vendorCode}</span>
                                    </div>
                                </div>
                                <div className="flex justify-between text-sm text-slate-400 ml-9 mt-1">
                                    <span>{v.skuCount} SKUs • {v.itemCount} items</span>
                                    <span className="text-white font-medium">{formatCurrency(v.totalAmount)}</span>
                                </div>
                                <div className="ml-9 mt-2 flex items-center text-xs">
                                    {v.hasAllFiles ? (
                                        <div className="flex items-center gap-1.5 text-green-400">
                                            <CheckBadgeIcon className="w-4 h-4 text-green-500" />
                                            <span>All files uploaded</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 text-yellow-400">
                                            <ExclamationTriangleIcon className="w-4 h-4 text-yellow-500" />
                                            <span>Missing customization files</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Submitted Vendors Section (Locked) */}
                    {submittedVendors.length > 0 && (
                        <div className="mt-6 pt-4 border-t border-slate-700/50">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Already Submitted</h4>
                            <div className="space-y-3 opacity-60">
                                {submittedVendors.map((v) => (
                                    <div 
                                        key={v.vendorCode}
                                        className="p-4 rounded-lg border border-slate-700 bg-slate-900/30 cursor-not-allowed"
                                    >
                                        <div className="flex items-center">
                                            <div className="w-5 h-5 flex items-center justify-center mr-4 bg-blue-600/20 text-blue-400 rounded">
                                                <CheckBadgeIcon className="w-4 h-4" />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-base font-medium text-slate-300">{v.vendorName}</span>
                                                <LockClosedIcon className="w-3 h-3 text-slate-500" />
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-sm text-slate-500 ml-9 mt-1">
                                            <span>Already submitted to {v.poRef}</span>
                                            <span className="font-medium">{formatCurrency(v.totalAmount)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-slate-900/50 rounded p-3 mt-6 flex justify-between items-center border border-slate-700/30">
                    <span className="text-sm text-slate-400 font-medium">Selected: <span className="text-white">{summary.count} vendors</span></span>
                    <span className="text-base font-bold text-white flex items-center gap-2">
                        <span className="text-xs font-normal text-slate-500 uppercase">Selected Total</span>
                        {formatCurrency(summary.totalAmount)}
                    </span>
                </div>

                <div className="flex gap-3 mt-4">
                    <Button 
                        variant="secondary" 
                        onClick={onClose}
                        className="flex-1 bg-slate-700 border-slate-600 hover:bg-slate-600 text-white"
                    >
                        Cancel
                    </Button>
                    <Button 
                        onClick={() => onConfirm(selectedVendorCodes)}
                        disabled={selectedVendorCodes.length === 0}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-900/20 py-3 h-auto font-bold flex items-center justify-center gap-2"
                    >
                        Submit Selected ({summary.count}) 
                        <PaperAirplaneIcon className="w-4 h-4 -rotate-45" />
                    </Button>
                </div>
            </div>
        </div>
    );
};