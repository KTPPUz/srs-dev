import { API_BASE_URL, STATIC_ONLY } from './config.js';

export const pdfAvailable = !STATIC_ONLY || !!API_BASE_URL;
export function apiUrl(path) {
  if (!pdfAvailable) throw new Error('บริการ PDF ยังไม่พร้อมใช้งาน ขณะนี้สามารถบีบอัดภาพได้');
  return `${API_BASE_URL.replace(/\/$/, '')}${path}`;
}
