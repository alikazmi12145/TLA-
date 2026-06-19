import { ASSET_BASE } from './constants';

export const asset = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
};

export const formatCurrency = (n, currency = 'PKR') =>
  `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const minutesToHours = (m) => `${Math.floor((m || 0) / 60)}h ${(m || 0) % 60}m`;

export const initials = (name = '') =>
  name.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
