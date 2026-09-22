import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { BarcodeProduct } from '../../../types';

type BarcodeFormat = 'EAN13' | 'UPC' | 'CODE128';

function detectFormat(value: string): BarcodeFormat {
  const v = value.trim();
  if (/^\d{13}$/.test(v)) return 'EAN13';
  if (/^\d{12}$/.test(v)) return 'UPC';
  return 'CODE128';
}

function BarcodeImage({ value, format }: { value: string; format: BarcodeFormat }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild);
      const moduleWidth = 2;
      JsBarcode(svgRef.current, value.trim(), {
        format,
        width: moduleWidth,
        height: 56,
        displayValue: true,
        font: 'OCRB',
        fontOptions: '',
        fontSize: 16,
        textMargin: 3,
        textAlign: 'center',
        background: '#FFFFFF',
        lineColor: '#000000',
        margin: Math.round(moduleWidth * 10),
      });
    } catch (err) {
      console.warn('[BarcodeLabel] jsbarcode failed:', err);
    }
  }, [value, format]);

  return (
    <svg
      ref={svgRef}
      className="select-none"
      style={{
        display: 'block',
        margin: '0 auto',
        background: '#FFFFFF',
        height: '16mm',
        width: '46mm',
        shapeRendering: 'crispEdges',
      }}
    />
  );
}

let fontsReadyPromise: Promise<void> | null = null;
function getFontsReady(): Promise<void> {
  if (!fontsReadyPromise) {
    fontsReadyPromise = Promise.all([
      document.fonts.load('normal 12px "OCRB"'),
      document.fonts.load('normal 12px "Rubik-Light"'),
      document.fonts.ready,
    ]).then(() => {}).catch(() => {});
  }
  return fontsReadyPromise;
}

function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => {
    try {
      return document.fonts.check('normal 12px "OCRB"') && document.fonts.check('normal 12px "Rubik-Light"');
    } catch { return false; }
  });
  useEffect(() => {
    if (ready) return;
    getFontsReady().then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
}

const formatMrp = (rawMrp: string) => {
  const clean = (rawMrp || '').trim();
  if (!clean) return 'Rs. -/-';
  if (/^rs/i.test(clean) || clean.toLowerCase() === '-/-') return clean;
  if (/^\d+(\.\d+)?$/.test(clean)) return `Rs. ${clean}/-`;
  if (clean.includes('/-')) return /^Rs\./i.test(clean) ? clean : `Rs. ${clean}`;
  return `Rs. ${clean}/-`;
};

const isValidBarcodeValue = (val?: string) => {
  const v = val?.trim() ?? '';
  return v !== '' && v !== '0' && !/0{5,}$/.test(v);
};

interface BarcodeLabelProps {
  product: BarcodeProduct;
  batchNo?: string;
  scale?: number;
}

/**
 * Cubelelo barcode label — 50mm x 30mm, ported unchanged (layout, fonts,
 * barcode priority) from the standalone barcode tool so printed labels stay
 * identical to what warehouse staff already scan against downstream.
 */
export const BarcodeLabel: React.FC<BarcodeLabelProps> = ({ product, batchNo, scale = 1.0 }) => {
  const fontsReady = useFontsReady();
  const nameRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState(product.product_name || '');

  useEffect(() => {
    const fullName = product.product_name || '';
    const el = nameRef.current;
    if (!fontsReady || !el) { setDisplayName(fullName); return; }

    const lineHeightPx = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
    const maxHeightPx = lineHeightPx * 2 + 1;

    const previous = el.textContent;
    el.textContent = fullName;
    if (el.scrollHeight <= maxHeightPx) {
      el.textContent = previous;
      setDisplayName(fullName);
      return;
    }

    let lo = 0, hi = fullName.length, best = '...';
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = fullName.slice(0, mid).trimEnd() + '...';
      el.textContent = candidate;
      if (el.scrollHeight <= maxHeightPx) { best = candidate; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    el.textContent = previous;
    setDisplayName(best);
  }, [product.product_name, fontsReady]);

  const fullSku = product.sku?.trim() || '990011';
  const barcodeValue = isValidBarcodeValue(product.EANUPC) ? product.EANUPC!.trim() : fullSku;
  const autoFormat = detectFormat(barcodeValue);

  if (!fontsReady) {
    return (
      <div style={{ width: '50mm', height: '30mm', background: '#ffffff' }} />
    );
  }

  return (
    <div
      className="relative flex flex-col justify-start select-none overflow-hidden origin-top-left bg-white text-black"
      style={{ width: '50mm', height: '30mm', padding: '1.2mm 1.8mm 0 1.8mm', boxSizing: 'border-box', transform: `scale(${scale})`, lineHeight: '1' }}
    >
      <div
        style={{
          display: 'grid', gridTemplateColumns: '13.5mm 2mm 1fr', rowGap: '0.3mm', columnGap: '0px',
          fontFamily: "'Rubik-Light', 'Rubik'", fontSize: '8px', fontWeight: 700, color: '#000000',
          backgroundColor: '#FFFFFF', lineHeight: '1', width: 'calc(100% - 4.8mm)', boxSizing: 'border-box',
        }}
      >
        <div style={{ fontWeight: 700 }}>Item</div>
        <div>:</div>
        <div ref={nameRef} style={{ wordBreak: 'break-word', whiteSpace: 'normal', fontWeight: 700, paddingRight: '0.5mm', overflow: 'hidden', maxHeight: '2em' }}>
          {displayName}
        </div>

        <div style={{ fontWeight: 700 }}>Item No</div>
        <div>:</div>
        <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{product.sku || '990011'}</div>

        <div style={{ fontWeight: 700 }}>MRP</div>
        <div>:</div>
        <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
          {formatMrp(product.mrp)}<span style={{ fontSize: '6.5px', fontWeight: 600 }}> (Incl. of all taxes)</span>
        </div>

        {batchNo?.trim() && (
          <>
            <div style={{ fontWeight: 700 }}>Batch No</div>
            <div>:</div>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{batchNo.trim()}</div>
          </>
        )}
      </div>

      <div style={{ flex: '1 1 auto' }} />

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', boxSizing: 'border-box', gap: '1mm' }}>
        <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', width: '46mm', height: '16mm', flexShrink: 0 }}>
            <BarcodeImage value={barcodeValue} format={autoFormat} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '2.6mm', flexShrink: 0 }}>
          <span style={{ display: 'inline-block', transform: 'rotate(-90deg)', transformOrigin: 'center', whiteSpace: 'nowrap', fontFamily: "'Rubik-Light', 'Rubik'", fontSize: '5px', fontWeight: 'bold', color: '#000000', letterSpacing: '0.2px', lineHeight: '1.0' }}>
            www.cubelelo.com
          </span>
        </div>
      </div>

      <div style={{ height: '1.2mm', flexShrink: 0 }} />
    </div>
  );
};
