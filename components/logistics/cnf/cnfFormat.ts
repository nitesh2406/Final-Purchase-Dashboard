export const fmtInr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtRmb = (n: number) => `¥${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// yyyy-mm-dd of a timestamp in India time (a UTC slice shows the previous day
// for anything stamped between 00:00 and 05:30 IST).
export const fmtIstDate = (iso: string) => {
  const d = new Date(iso);
  return iso && !isNaN(d.getTime()) ? d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
};

// One CSV cell. Text starting with = + - @ is prefixed with ' so a
// spreadsheet opening the export shows it instead of running it as a formula.
export const csvCell = (v: string | number | null | undefined) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
