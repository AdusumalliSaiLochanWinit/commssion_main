import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value, decimals = 1) {
  return `${Number(value).toFixed(decimals)}%`;
}

export function formatNumber(num) {
  return new Intl.NumberFormat('en-AE').format(num);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

export function getStatusColor(status) {
  const colors = {
    draft: 'badge-gray',
    active: 'badge-success',
    expired: 'badge-danger',
    archived: 'badge-gray',
    pending: 'badge-warning',
    submitted: 'badge-info',
    manager_approved: 'badge-info',
    finance_approved: 'badge-info',
    hr_approved: 'badge-success',
    rejected: 'badge-danger',
    locked: 'badge-success',
    running: 'badge-warning',
    completed: 'badge-success',
    failed: 'badge-danger',
  };
  return colors[status] || 'badge-gray';
}

export function getStatusLabel(status) {
  return status?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';
}
