
import { Batch, BatchMetrics } from '../types';
import { mockBatches, mockMetrics } from '../utils/mockBatchData';

// Temporary mock implementations
// Will be replaced with google.script.run calls in Phase 3

export const batchService = {
  // Get all batches with optional filters
  getBatches: async (): Promise<Batch[]> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(mockBatches), 500);
    });
  },

  // Get single batch details with vendor shipments
  getBatchDetails: async (batchId: string): Promise<Batch | null> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const batch = mockBatches.find(b => b.batch_id === batchId);
        resolve(batch || null);
      }, 500);
    });
  },

  // Get dashboard metrics
  getMetrics: async (): Promise<BatchMetrics> => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(mockMetrics), 300);
    });
  }
};
