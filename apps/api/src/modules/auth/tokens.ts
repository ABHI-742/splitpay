import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export interface AccessClaims {
  sub: string;
}

export class TokenService {
  constructor(
    private readonly privateKey: string,
    private readonly publicKey: string,
  ) {}

  signAccess(userId: string): string {
    return jwt.sign({}, this.privateKey, {
      algorithm: 'RS256',
      subject: userId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  verifyAccess(token: string): AccessClaims {
    const payload = jwt.verify(token, this.publicKey, { algorithms: ['RS256'] });
    if (typeof payload === 'string' || !payload.sub) throw new Error('Malformed token');
    return { sub: payload.sub };
  }
}

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
