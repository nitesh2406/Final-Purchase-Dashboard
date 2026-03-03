import React, { useState, useRef } from 'react';
import { Button } from '../ui/Button';
import { XMarkIcon, CloudArrowUpIcon, DocumentTextIcon } from '../icons/Icons';

interface AddNewSKUModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    vendors: string[];
}

export const AddNewSKUModal: React.FC<AddNewSKUModalProps> = ({ isOpen, onClose, onSave, vendors }) => {
    const [skuCode, setSkuCode] = useState('');
    const [itemName, setItemName] = useState('');
    const [category, setCategory] = useState('Apparel');
    const [vendor, setVendor] = useState(vendors[0] || '');
    const [unitPrice, setUnitPrice] = useState<number>(0);
    // FIX 5: Don't default to 1, let user specify or use 0
    const [quantity, setQuantity] = useState<number>(0); 
    const [description, setDescription] = useState('');
    const [logo, setLogo] = useState<'Yes' | 'No'>('No');
    const [packaging, setPackaging] = useState<'Yes' | 'No'>('No');
    const [manual, setManual] = useState<'Yes' | 'No'>('No');
    const [wrap, setWrap] = useState<'Yes' | 'No'>('No');
    const [remarks, setRemarks] = useState('');
    const [files, setFiles] = useState<any[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!skuCode || !itemName || !vendor || unitPrice <= 0) {
            alert('Please fill all required fields');
            return;
        }

        onSave({
            skuCode,
            itemName,
            category,
            vendor,
            unitPrice,
            quantity,
            description,
            logo,
            packaging,
            manual,
            wrap,
            remarks,
            files
        });
    };

    const processFiles = (fileList: FileList) => {
        const newFiles: any[] = [];
        Array.from(fileList).forEach(file => {
            newFiles.push({
                name: file.name,
                size: file.size < 1024 * 1024 
                    ? `${(file.size / 1024).toFixed(1)} KB` 
                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                type: file.type
            });
        });
        setFiles(prev => [...prev, ...newFiles]);
    };

    const inputClasses = "w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600";
    const labelClasses = "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5";

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[110] p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-[#1e293b] border border-slate-700 rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700">
                    <div>
                        <h2 className="text-xl font-semibold text-white">Add New SKU</h2>
                        <p className="text-sm text-slate-400 mt-1">Create new item and add to draft</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[75vh]">
                    <div className="p-6 space-y-6">
                        {/* Basic Info Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClasses}>SKU Code *</label>
                                <input 
                                    type="text" 
                                    required 
                                    placeholder="e.g., SKU-101" 
                                    className={inputClasses}
                                    value={skuCode}
                                    onChange={e => setSkuCode(e.target.value)}
                                />
                                <p className="text-[10px] text-slate-500 mt-1">Suggested: SKU-{(Math.floor(Math.random() * 900) + 100)}</p>
                            </div>
                            <div>
                                <label className={labelClasses}>Item Name *</label>
                                <input 
                                    type="text" 
                                    required 
                                    placeholder="e.g., Cotton T-Shirt (Red)" 
                                    className={inputClasses}
                                    value={itemName}
                                    onChange={e => setItemName(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className={labelClasses}>Category</label>
                                <select className={inputClasses} value={category} onChange={e => setCategory(e.target.value)}>
                                    <option value="Apparel">Apparel</option>
                                    <option value="Accessories">Accessories</option>
                                    <option value="Electronics">Electronics</option>
                                    <option value="Packaging">Packaging</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClasses}>Vendor *</label>
                                {vendors.length > 0 ? (
                                    <>
                                        <select 
                                            className={inputClasses} 
                                            required 
                                            value={vendor} 
                                            onChange={e => setVendor(e.target.value)}
                                        >
                                            <option value="">Select Vendor</option>
                                            {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                                            <option value="NEW">--- Use New Vendor Name Below ---</option>
                                        </select>
                                        {(vendor === 'NEW' || !vendors.includes(vendor)) && (
                                            <input 
                                                type="text" 
                                                required 
                                                placeholder="Enter New Vendor Name" 
                                                className={`${inputClasses} mt-2 border-blue-500/50`}
                                                value={vendor === 'NEW' ? '' : vendor}
                                                onChange={e => setVendor(e.target.value)}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <input 
                                        type="text" 
                                        required 
                                        placeholder="Vendor Name" 
                                        className={inputClasses}
                                        value={vendor}
                                        onChange={e => setVendor(e.target.value)}
                                    />
                                )}
                            </div>
                            <div>
                                <label className={labelClasses}>Unit Price (₹) *</label>
                                <input 
                                    type="number" 
                                    required 
                                    placeholder="1000" 
                                    className={inputClasses}
                                    value={unitPrice || ''}
                                    onChange={e => setUnitPrice(parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div>
                                <label className={labelClasses}>Quantity</label>
                                <input 
                                    type="number" 
                                    required 
                                    placeholder="10" 
                                    className={inputClasses}
                                    value={quantity}
                                    onChange={e => setQuantity(parseInt(e.target.value) || 0)}
                                />
                            </div>
                            <div className="col-span-2">
                                <label className={labelClasses}>Description (Optional)</label>
                                <textarea 
                                    rows={3} 
                                    className={`${inputClasses} resize-none`} 
                                    placeholder="Add item description..."
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Customizations Section */}
                        <div className="pt-4 border-t border-slate-700">
                            <h3 className={labelClasses}>Customization Options</h3>
                            <div className="grid grid-cols-4 gap-4 mt-3">
                                <div>
                                    <label className="text-[10px] text-slate-400 mb-1 block">Logo</label>
                                    <select value={logo} onChange={e => setLogo(e.target.value as any)} className={inputClasses}>
                                        <option value="No">No</option>
                                        <option value="Yes">Yes</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-400 mb-1 block">Packaging</label>
                                    <select value={packaging} onChange={e => setPackaging(e.target.value as any)} className={inputClasses}>
                                        <option value="No">No</option>
                                        <option value="Yes">Yes</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-400 mb-1 block">Manual</label>
                                    <select value={manual} onChange={e => setManual(e.target.value as any)} className={inputClasses}>
                                        <option value="No">No</option>
                                        <option value="Yes">Yes</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-400 mb-1 block">Wrap</label>
                                    <select value={wrap} onChange={e => setWrap(e.target.value as any)} className={inputClasses}>
                                        <option value="No">No</option>
                                        <option value="Yes">Yes</option>
                                    </select>
                                </div>
                            </div>
                            <div className="mt-4">
                                <label className={labelClasses}>Remarks</label>
                                <textarea 
                                    rows={2} 
                                    className={`${inputClasses} resize-none`} 
                                    placeholder="Special instructions..."
                                    value={remarks}
                                    onChange={e => setRemarks(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* File Upload */}
                        <div className="pt-4 border-t border-slate-700">
                            <label className={labelClasses}>Customization Files</label>
                            <div 
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files); }}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all mt-2 ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 hover:bg-slate-800/50'}`}
                            >
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    className="hidden" 
                                    multiple 
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    onChange={(e) => e.target.files && processFiles(e.target.files)}
                                />
                                <CloudArrowUpIcon className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                                <p className="text-sm text-slate-300">Click or drag files to upload</p>
                                <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG (Max 10MB each)</p>
                            </div>
                            {files.length > 0 && (
                                <div className="mt-4 space-y-2">
                                    {files.map((file, idx) => (
                                        <div key={idx} className="bg-slate-700/50 border border-slate-600 rounded-md p-2 flex items-center gap-3">
                                            <DocumentTextIcon className="w-5 h-5 text-slate-400" />
                                            <div className="flex-grow min-w-0">
                                                <p className="text-xs text-white truncate">{file.name}</p>
                                                <p className="text-[10px] text-slate-400">{file.size}</p>
                                            </div>
                                            <button 
                                                type="button"
                                                onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                                                className="p-1 text-slate-400 hover:text-red-500"
                                            >
                                                <XMarkIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-slate-700 flex justify-end gap-3 bg-slate-900/30">
                        <Button type="button" variant="secondary" onClick={onClose} className="h-10 px-6 border-slate-600 text-slate-300">Cancel</Button>
                        <Button type="submit" className="h-10 px-8 bg-blue-600 hover:bg-blue-700 border-none font-semibold">Add to Draft</Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
