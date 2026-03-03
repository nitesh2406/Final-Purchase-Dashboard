
import { Batch, BatchMetrics } from '../types';

export const mockBatches: Batch[] = [
  {
    batch_id: 'B-2024-001',
    batch_type: 'sea',
    status: 'In-Transit India',
    total_shipments: 3,
    total_vendors: 2,
    total_cartons: 15,
    total_units: 350,
    original_amount_rmb: 85000,
    duty_charges_inr: 12500,
    landing_charges_inr: 3200,
    final_total_inr: 1265700,
    created_at: '2024-01-15T10:30:00Z',
    created_by: 'admin@company.com',
    shipped_at: '2024-02-01T08:00:00Z',
    expected_delivery: '2024-02-20T00:00:00Z',
    actual_delivery: null,
    tracking_number: 'MAEU123456',
    carrier: 'Maersk',
    notes: 'Handle with care - fragile items',
    is_delayed: false,
    delay_days: 0,
    vendor_shipments: [
      {
        shipment_id: 'VS-2024-045',
        vendor_code: 'PW',
        vendor_name: 'Premium Wholesale',
        invoice_no: 'INV-001',
        invoice_date: '2024-01-20',
        total_units: 150,
        carton_count: 6,
        remarks: '',
        line_items: [
          {
            line_id: 'L-001',
            sku: 'PUR-SNEA-XL-43',
            item_name: 'Purple Sneakers XL',
            factory_code: 'FC-SNK-001',
            ean: '8901234567890',
            incoming_qty: 100,
            current_stock: 224,
            future_stock: 324,
            mma: 25,
            doc_after_arrival: 13,
            has_logo: true,
            has_packaging: true,
            has_manual: true,
            has_opp_wrap: true
          },
          {
            line_id: 'L-002',
            sku: 'BLU-CAP-M-28',
            item_name: 'Blue Caps M',
            factory_code: 'FC-CAP-045',
            ean: '8901234567891',
            incoming_qty: 50,
            current_stock: 45,
            future_stock: 95,
            mma: 10,
            doc_after_arrival: 9,
            has_logo: true,
            has_packaging: false,
            has_manual: false,
            has_opp_wrap: true
          }
        ]
      },
      {
        shipment_id: 'VS-2024-046',
        vendor_code: 'QY',
        vendor_name: 'Quality Yarn',
        invoice_no: 'INV-045',
        invoice_date: '2024-01-22',
        total_units: 200,
        carton_count: 5,
        remarks: '',
        line_items: [
          {
            line_id: 'L-003',
            sku: 'RED-HOOD-L-19',
            item_name: 'Red Hoodies L',
            factory_code: 'FC-HOD-012',
            ean: '8901234567892',
            incoming_qty: 200,
            current_stock: 180,
            future_stock: 380,
            mma: 30,
            doc_after_arrival: 12,
            has_logo: true,
            has_packaging: true,
            has_manual: false,
            has_opp_wrap: true
          }
        ]
      }
    ]
  },
  {
    batch_id: 'B-2024-002',
    batch_type: 'air',
    status: 'Customs Clearance',
    total_shipments: 2,
    total_vendors: 2,
    total_cartons: 8,
    total_units: 280,
    original_amount_rmb: 52000,
    duty_charges_inr: 6200,
    landing_charges_inr: 2000,
    final_total_inr: 828000,
    created_at: '2024-01-18T14:20:00Z',
    created_by: 'admin@company.com',
    shipped_at: '2024-02-05T12:00:00Z',
    expected_delivery: '2024-02-16T00:00:00Z',
    actual_delivery: null,
    tracking_number: 'DHL987654',
    carrier: 'DHL',
    notes: 'Priority shipment',
    is_delayed: true,
    delay_days: 2,
    vendor_shipments: [
      {
        shipment_id: 'VS-2024-048',
        vendor_code: 'MY',
        vendor_name: 'Modern Yarns',
        invoice_no: 'INV-078',
        invoice_date: '2024-01-25',
        total_units: 150,
        carton_count: 4,
        remarks: '',
        line_items: [
          {
            line_id: 'L-006',
            sku: 'WHT-SHIRT-L-12',
            item_name: 'White Shirts L',
            factory_code: 'FC-SHT-045',
            ean: '8901234567895',
            incoming_qty: 150,
            current_stock: 56,
            future_stock: 206,
            mma: 20,
            doc_after_arrival: 10,
            has_logo: true,
            has_packaging: true,
            has_manual: true,
            has_opp_wrap: true
          }
        ]
      },
      {
        shipment_id: 'VS-2024-049',
        vendor_code: 'XY',
        vendor_name: 'Xpress Yarns',
        invoice_no: 'INV-123',
        invoice_date: '2024-01-28',
        total_units: 130,
        carton_count: 4,
        remarks: 'Rush order',
        line_items: [
          {
            line_id: 'L-007',
            sku: 'BLK-SHOE-XL-89',
            item_name: 'Black Shoes XL',
            factory_code: 'FC-SHO-098',
            ean: '8901234567896',
            incoming_qty: 130,
            current_stock: 12,
            future_stock: 142,
            mma: 18,
            doc_after_arrival: 7,
            has_logo: false,
            has_packaging: false,
            has_manual: true,
            has_opp_wrap: false
          }
        ]
      }
    ]
  },
  {
    batch_id: 'B-2024-003',
    batch_type: 'sea',
    status: 'Delivered',
    total_shipments: 4,
    total_vendors: 3,
    total_cartons: 22,
    total_units: 550,
    original_amount_rmb: 125000,
    duty_charges_inr: 18500,
    landing_charges_inr: 4200,
    final_total_inr: 1897700,
    created_at: '2024-01-10T09:00:00Z',
    created_by: 'admin@company.com',
    shipped_at: '2024-01-20T08:00:00Z',
    expected_delivery: '2024-02-10T00:00:00Z',
    actual_delivery: '2024-02-09T14:30:00Z',
    tracking_number: 'MSCU445566',
    carrier: 'MSC',
    notes: '',
    is_delayed: false,
    delay_days: 0
  },
  {
    batch_id: 'B-2024-004',
    batch_type: 'air',
    status: 'Shipped',
    total_shipments: 1,
    total_vendors: 1,
    total_cartons: 5,
    total_units: 120,
    original_amount_rmb: 22000,
    duty_charges_inr: 2500,
    landing_charges_inr: 800,
    final_total_inr: 325000,
    created_at: '2024-02-01T09:00:00Z',
    created_by: 'admin@company.com',
    shipped_at: '2024-02-12T10:00:00Z',
    expected_delivery: '2024-02-18T00:00:00Z',
    actual_delivery: null,
    tracking_number: 'FEDEX789012',
    carrier: 'FedEx',
    notes: '',
    is_delayed: false,
    delay_days: 0
  },
  {
    batch_id: 'B-2024-005',
    batch_type: 'sea',
    status: 'In-Transit China',
    total_shipments: 2,
    total_vendors: 2,
    total_cartons: 18,
    total_units: 420,
    original_amount_rmb: 65000,
    duty_charges_inr: 8500,
    landing_charges_inr: 2200,
    final_total_inr: 965000,
    created_at: '2024-02-05T11:00:00Z',
    created_by: 'admin@company.com',
    shipped_at: '2024-02-14T08:00:00Z',
    expected_delivery: '2024-03-05T00:00:00Z',
    actual_delivery: null,
    tracking_number: 'COSCO345678',
    carrier: 'COSCO',
    notes: '',
    is_delayed: false,
    delay_days: 0
  }
];

export const mockMetrics: BatchMetrics = {
  activeBatches: 8,
  inTransitValue: 4520000,
  arrivingThisWeek: 3,
  delayedShipments: 2
};

export const filterBatches = (
  batches: Batch[],
  filters: { search: string; status: string; mode: string }
): Batch[] => {
  return batches.filter(batch => {
    const matchesSearch = filters.search === '' || 
      batch.batch_id.toLowerCase().includes(filters.search.toLowerCase()) ||
      batch.tracking_number.toLowerCase().includes(filters.search.toLowerCase()) ||
      batch.carrier.toLowerCase().includes(filters.search.toLowerCase());
    
    const matchesStatus = filters.status === 'All' || batch.status === filters.status;
    const matchesMode = filters.mode === 'All' || batch.batch_type === filters.mode;
    
    return matchesSearch && matchesStatus && matchesMode;
  });
};
