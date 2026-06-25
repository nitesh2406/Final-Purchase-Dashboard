import React from 'react';

export const SkeletonDashboard: React.FC = () => {
  return (
    <div className="p-6 md:p-8 space-y-8 animate-pulse">
      {/* Page Header Skeleton */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-gray-250 dark:bg-gray-800 rounded-lg"></div>
          <div className="h-4 w-72 bg-gray-200 dark:bg-gray-800 rounded-md"></div>
        </div>
        <div className="h-10 w-32 bg-gray-250 dark:bg-gray-800 rounded-lg"></div>
      </div>

      {/* Metrics Ribbon Grid Skeleton (4 overview cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-28 bg-gray-200 dark:bg-slate-800 rounded-md"></div>
              <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-slate-800"></div>
            </div>
            <div className="space-y-2">
              <div className="h-7 w-20 bg-gray-200 dark:bg-slate-800 rounded-lg"></div>
              <div className="h-3.5 w-32 bg-gray-100 dark:bg-slate-800/60 rounded-md"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Table Container Skeleton */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-md overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-between items-center gap-4 bg-gray-50/50 dark:bg-gray-900/30">
          <div className="h-10 w-full sm:w-64 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
          <div className="flex gap-2.5 w-full sm:w-auto">
            <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            <div className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
          </div>
        </div>

        {/* Rows Skeleton */}
        <div className="overflow-x-auto">
          <div className="min-w-full divide-y divide-gray-150 dark:divide-gray-700">
            {/* Header row */}
            <div className="bg-gray-50/50 dark:bg-gray-900/50 px-6 py-4 flex justify-between">
              <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
              <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
              <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
              <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
            </div>

            {/* Content rows */}
            {[1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} className="px-6 py-5 flex justify-between items-center">
                <div className="space-y-2">
                  <div className="h-5 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
                  <div className="h-3.5 w-40 bg-gray-150 dark:bg-gray-700/60 rounded-md"></div>
                </div>
                <div className="h-4.5 w-16 bg-gray-250 dark:bg-gray-700 rounded-md"></div>
                <div className="h-6 w-24 bg-gray-150 dark:bg-gray-700/60 rounded-full"></div>
                <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
