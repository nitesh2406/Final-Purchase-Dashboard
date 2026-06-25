import React from 'react';
import { Button } from '../ui/Button';
import { ExclamationTriangleIcon, XMarkIcon, InformationCircleIcon } from '../icons/Icons';

interface CancelDraftModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    draftId: string;
    status?: string;
}

export const CancelDraftModal: React.FC<CancelDraftModalProps> = ({ isOpen, onClose, onConfirm, draftId, status }) => {
    if (!isOpen) return null;

    const isPartial = status === 'PARTIALLY_SUBMITTED';

    return (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
            <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-8 overflow-hidden animate-in zoom-in-95 duration-200 relative">
                <button onClick={onClose} className="absolute top-5 right-5 text-slate-400 hover:text-white transition-colors">
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
                        <ExclamationTriangleIcon className="w-10 h-10 text-red-500" />
                    </div>
                </div>

                <div className="text-center">
                    <h3 className="text-2xl font-bold text-white tracking-tight">Cancel Draft Order?</h3>
                    <p className="text-slate-400 mt-2 font-medium">Draft PO: <span className="text-slate-200 font-bold">{draftId}</span></p>
                </div>

                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mt-8 flex gap-3">
                    <InformationCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200 leading-relaxed font-medium">
                        This action cannot be undone. The draft order will be marked as cancelled and moved to the bottom of your list.
                    </p>
                </div>

                {isPartial && (
                    <div className="mt-4 px-2">
                        <p className="text-[11px] text-slate-500 text-center leading-relaxed italic">
                            <span className="font-bold text-slate-400 uppercase mr-1">Note:</span> 
                            Already submitted Purchase Orders (PO-xxx) associated with this draft will remain active in your PO history.
                        </p>
                    </div>
                )}

                <div className="flex gap-3 mt-10">
                    <Button 
                        variant="secondary" 
                        onClick={onClose} 
                        className="flex-1 bg-transparent border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white h-11 text-sm font-bold"
                    >
                        Keep Draft
                    </Button>
                    <Button 
                        onClick={onConfirm}
                        className="flex-1 bg-red-600 hover:bg-red-700 border-none font-bold shadow-xl shadow-red-900/30 h-11 text-sm text-white focus:ring-2 focus:ring-red-500"
                    >
                        Cancel Order
                    </Button>
                </div>
            </div>
        </div>
    );
};