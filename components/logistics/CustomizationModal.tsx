import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { 
    XMarkIcon, LinkIcon, InformationCircleIcon
} from '../icons/Icons';

interface CustomizationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    skuData: {
        sku: string;
        itemName: string;
        logo: 'Yes' | 'No';
        packaging: 'Yes' | 'No';
        manual: 'Yes' | 'No';
        wrap: 'Yes' | 'No';
        remarks: string;
        customization_files: string;
        source: 'FORECAST' | 'MANUAL';
    } | null;
}

export const CustomizationModal: React.FC<CustomizationModalProps> = ({ isOpen, onClose, onSave, skuData }) => {
    const [logo, setLogo] = useState<'Yes' | 'No'>('No');
    const [packaging, setPackaging] = useState<'Yes' | 'No'>('No');
    const [manual, setManual] = useState<'Yes' | 'No'>('No');
    const [wrap, setWrap] = useState<'Yes' | 'No'>('No');
    const [remarks, setRemarks] = useState('');
    const [driveLink, setDriveLink] = useState('');

    useEffect(() => {
        if (skuData) {
            setLogo(skuData.logo);
            setPackaging(skuData.packaging);
            setManual(skuData.manual);
            setWrap(skuData.wrap);
            setRemarks(skuData.remarks);
            setDriveLink(skuData.customization_files || '');
        }
    }, [skuData, isOpen]);

    if (!isOpen || !skuData) return null;

    const handleSave = () => {
        onSave({
            logo,
            packaging,
            manual,
            wrap,
            remarks,
            customization_files: driveLink
        });
        onClose();
    };

    const selectClasses = "w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none transition-all cursor-pointer hover:border-slate-500";
    const labelClasses = "block text-sm text-slate-400 mb-2 font-medium";
    const inputClasses = "w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600";

    const isForecast = skuData.source === 'FORECAST';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div 
                className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700">
                    <h2 className="text-lg font-semibold text-white truncate pr-4">
                        Customization Details - <span className="text-blue-400">{skuData.itemName}</span>
                    </h2>
                    <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Form Body */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClasses}>Custom Logo</label>
                            <select value={logo} onChange={e => setLogo(e.target.value as any)} className={selectClasses}>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>Custom Packaging</label>
                            <select value={packaging} onChange={e => setPackaging(e.target.value as any)} className={selectClasses}>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>Solving Manual</label>
                            <select value={manual} onChange={e => setManual(e.target.value as any)} className={selectClasses}>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>OPP Wrap</label>
                            <select value={wrap} onChange={e => setWrap(e.target.value as any)} className={selectClasses}>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                            </select>
                        </div>
                        
                        <div className="col-span-2">
                            <label className={labelClasses}>Other Remarks</label>
                            <textarea 
                                rows={3}
                                value={remarks}
                                onChange={e => setRemarks(e.target.value)}
                                placeholder="Add any special instructions..."
                                className="w-full bg-slate-800 border border-slate-600 rounded-md p-3 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none placeholder:text-slate-600"
                            />
                        </div>

                        <div className="col-span-2">
                            <label className={labelClasses}>Customization Drive Link</label>
                            {isForecast ? (
                                <div className="space-y-3">
                                    {driveLink ? (
                                        <a 
                                            href={driveLink} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-md hover:bg-blue-600/30 transition-colors text-sm font-semibold"
                                        >
                                            <LinkIcon className="w-4 h-4" />
                                            Open Customization Folder
                                        </a>
                                    ) : (
                                        <div className="flex items-center gap-2 text-slate-500 italic text-sm py-2">
                                            <InformationCircleIcon className="w-4 h-4" />
                                            No Customization in this product.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            value={driveLink}
                                            onChange={e => setDriveLink(e.target.value)}
                                            placeholder="Paste Google Drive folder or file link"
                                            className={inputClasses}
                                        />
                                        {driveLink && (
                                            <a 
                                                href={driveLink} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="p-2 bg-slate-700 rounded-md text-blue-400 hover:bg-slate-600 transition-colors"
                                                title="Test Link"
                                            >
                                                <LinkIcon className="w-5 h-5" />
                                            </a>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-slate-500">Provide a link to design assets, templates, or instructions on Google Drive.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-700 flex justify-between bg-slate-900/30">
                    <Button 
                        variant="secondary" 
                        onClick={onClose}
                        className="h-10 px-6 border-slate-600 text-slate-300 hover:bg-slate-700"
                    >
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSave}
                        className="h-10 px-8 bg-blue-600 hover:bg-blue-700 border-none font-semibold shadow-lg shadow-blue-900/20"
                    >
                        Save Details
                    </Button>
                </div>
            </div>
        </div>
    );
};
