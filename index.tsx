import React from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';

// Clear previous cached data per user request
if (!localStorage.getItem('cache_cleared_2026_06_08_v1')) {
  localStorage.removeItem('purchase_invoices_table');
  localStorage.removeItem('payment_logs_table');
  localStorage.removeItem('settlement_records_table');
  localStorage.removeItem('last_eod_success_time');
  localStorage.removeItem('vendor_shipment_draft');
  localStorage.setItem('cache_cleared_2021_06_05_v1', 'true'); // clear legacy flags
  localStorage.setItem('cache_cleared_2026_06_05_v1', 'true'); // clear legacy flags
  localStorage.setItem('cache_cleared_2026_06_08_v1', 'true');
}


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
     <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>
);