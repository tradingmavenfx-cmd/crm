import axios from 'axios';

export const PORTAL_API =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * The portal session is not a CRM login: it is an opaque token tied to one
 * contact in one workspace, so it is stored per workspace and never shares
 * storage with the staff app's tokens.
 */
const key = (tenantId: string) => `crm_portal_${tenantId}`;

export const portalSession = {
  get: (tenantId: string) =>
    typeof window !== 'undefined' ? localStorage.getItem(key(tenantId)) : null,
  set: (tenantId: string, token: string) =>
    localStorage.setItem(key(tenantId), token),
  clear: (tenantId: string) => localStorage.removeItem(key(tenantId)),
};

/** An axios instance carrying the portal session for one workspace. */
export const portalApi = (tenantId: string) => {
  const token = portalSession.get(tenantId);
  return axios.create({
    baseURL: PORTAL_API,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};
