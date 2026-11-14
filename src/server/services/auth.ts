import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import type { User, UserRole } from '../../types.js';

// No hardcoded secret: use JWT_SECRET from env, else a random key generated once and stored in the database.
function jwtSecret(): string {
  return process.env.JWT_SECRET || db.getOrCreateSecret('jwt');
}
const PASSWORD_CHANGE_ALLOWED = ['/api/auth/change-password', '/api/auth/me'];

export interface AuthRequest extends Request {
  user?: User;
}

export function generateToken(user: User): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id,
    },
    jwtSecret(),
    { expiresIn: '8h' }
  );
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, jwtSecret()) as { id: string; role: UserRole };
    const data = db.getData();
    const user = data.users.find((u) => u.id === decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'User account not found.' });
    }

    if (user.status === 'deactivated') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact Admin.' });
    }

    // Mandatory first-login password change: until done, only change-password / me are reachable.
    if (user.must_change_password && !PASSWORD_CHANGE_ALLOWED.includes(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ error: 'You must change your temporary password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: role '${req.user.role}' lacks permission for this action. Allowed: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Enforces employee data scope:
 * If user is 'employee', they can ONLY access records belonging to their own employee_id.
 * Admins and HR can access all records.
 */
export function enforceDataScope(req: AuthRequest, targetEmployeeId: string): boolean {
  if (!req.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'hr') return true;
  return req.user.employee_id === targetEmployeeId;
}
