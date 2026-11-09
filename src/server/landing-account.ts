import type { NextRequest } from 'next/server';
import { session, HttpError } from './auth.ts';

// Never infer sign-in from cookie presence. Reuse expiry, suspension and MFA checks.
// Ignore workspace selection: a stale workspace cookie does not end the login.
export async function landingAccount(req: NextRequest): Promise<boolean> {
  try { await session(req, true); return true; }
  catch(error) {
    if(error instanceof HttpError && [401,403].includes(error.status)) return false;
    throw error;
  }
}
