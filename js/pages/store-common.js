// Shared bits for the store pages (checks, records, team).
import { state, html, isManager } from '../lib.js';

// Store accounts and inspectors are tied to one store; head office picks one
// (remembered on this device).
export function myStoreId(stores) {
  if (state.profile.store_id && !isManager()) return state.profile.store_id;
  const saved = localStorage.getItem('cg-store');
  return (stores.find(s => s.id === saved) || stores[0]).id;
}

export function storeSelect(stores, storeId) {
  if (!isManager() || stores.length < 2) return '';
  return html`<label style="margin:0;min-width:220px">Store<select data-store>${stores.map(s =>
    html`<option value="${s.id}" ${s.id === storeId ? 'selected' : ''}>${s.name}${s.code ? ' (' + s.code + ')' : ''}</option>`)}</select></label>`;
}

export function bindStoreSelect(main, onChange) {
  const sel = main.querySelector('[data-store]');
  if (sel) sel.onchange = () => { localStorage.setItem('cg-store', sel.value); onChange(); };
}

export const isStoreRole = () => ['store_manager', 'store'].includes(state.profile?.role);
export const isInspector = () => state.profile?.role === 'inspector';

// The 14 allergens UK law requires us to declare.
export const ALLERGENS = ['celery', 'cereals containing gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs',
  'mustard', 'tree nuts', 'peanuts', 'sesame', 'soya', 'sulphites'];
