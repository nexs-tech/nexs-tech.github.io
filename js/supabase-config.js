/**
 * Safety Union Bank – Supabase client
 * Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
 * NEVER put the service_role key in frontend code.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---- CONFIG (replace before deploy) ----
export const SUPABASE_URL = 'https://ostmbucbsptftvbwhmjc.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_0eJBR0X5fmU1FTyu346etQ_6syHbiCo';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,
  },
});

/** Table prefix for this product – keeps data isolated from other apps on the same project */
export const PREFIX = 'sub_';

export const tables = {
  profiles: `${PREFIX}profiles`,
  payment_requests: `${PREFIX}payment_requests`,
  transactions: `${PREFIX}transactions`,
  withdrawals: `${PREFIX}withdrawals`,
  banks: `${PREFIX}banks`,
  devices: `${PREFIX}devices`,
};

/** Fee schedule (mirrors server-side enforcement) */
export const FEES = {
  receive: 0.015,
  withdraw: 0.01,
  withdrawFixed: 0.5,
  sub2sub: 0,
  proDiscount: 0.5,
};

export function calcFee(amount, type, isPro = false) {
  let fee = 0;
  if (type === 'receive') fee = amount * FEES.receive;
  else if (type === 'withdraw') fee = amount * FEES.withdraw + FEES.withdrawFixed;
  else if (type === 'sub2sub') fee = FEES.sub2sub;
  if (isPro) fee *= FEES.proDiscount;
  return Math.round(fee * 100) / 100;
}

export function genTempRef() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  const hex = [...r].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `SUB-TMP-${hex.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
}

/** Time-based greeting in WAT context */
export function greetingFor(name) {
  const h = new Date().getHours();
  let g = 'Good evening';
  if (h >= 5 && h < 12) g = 'Good morning';
  else if (h >= 12 && h < 17) g = 'Good afternoon';
  const first = (name || 'there').split(' ')[0];
  return `${g}, ${first}`;
}

/** Require authenticated session; redirect to login if missing */
export async function requireAuth(redirectPath) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const q = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : '';
    window.location.href = `/pages/login.html${q}`;
    return null;
  }
  return session;
}

/** Load profile row for current user */
export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from(tables.profiles)
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.error('profile fetch', error);
    return null;
  }
  return data;
}

export function initials(name = '') {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'SU';
}
