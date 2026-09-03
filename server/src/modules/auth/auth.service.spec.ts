import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_POLICY, SecurityService } from '../security/security.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let security: {
    policy: jest.Mock;
    lockout: jest.Mock;
    recordAttempt: jest.Mock;
    createSession: jest.Mock;
    liveSession: jest.Mock;
    rotateSession: jest.Mock;
    revokeByToken: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn(), create: jest.fn() },
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn(),
    };
    security = {
      policy: jest.fn().mockResolvedValue(DEFAULT_POLICY),
      lockout: jest.fn().mockResolvedValue({ locked: false, failures: 0 }),
      recordAttempt: jest.fn().mockResolvedValue({}),
      createSession: jest.fn().mockResolvedValue({ id: 's1' }),
      liveSession: jest.fn().mockResolvedValue(null),
      rotateSession: jest.fn().mockResolvedValue({}),
      revokeByToken: jest.fn().mockResolvedValue({ revoked: 1 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: SecurityService, useValue: security },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => `cfg-${k}` },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('registers a new tenant + admin and returns tokens', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        tenant: {
          create: jest.fn().mockResolvedValue({ id: 't1', slug: 'acme' }),
        },
        user: {
          create: jest.fn().mockResolvedValue({
            id: 'u1',
            tenantId: 't1',
            email: 'admin@acme.com',
            firstName: 'Ada',
            lastName: 'Admin',
            role: Role.TENANT_ADMIN,
          }),
        },
      }),
    );
    prisma.user.update.mockResolvedValue({});

    const result = await service.register({
      organizationName: 'Acme',
      email: 'admin@acme.com',
      password: 'supersecret',
      firstName: 'Ada',
      lastName: 'Admin',
    });

    expect(result.user.role).toBe(Role.TENANT_ADMIN);
    expect(result.tenantSlug).toBe('acme');
    expect(result.tokens.accessToken).toBe('signed-token');
    expect(result.tokens.refreshToken).toBe('signed-token');
  });

  it('rejects login with an unknown tenant, naming the workspace', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'x@y.com',
        password: 'pw',
        tenantSlug: 'nope',
      }),
    ).rejects.toThrow('Workspace "nope" not found');
  });

  it('does not leak whether an email exists when the password is wrong', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      isActive: true,
      slug: 'acme',
    });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'nobody@acme.com',
        password: 'pw',
        tenantSlug: 'acme',
      }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects login with a wrong password', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      isActive: true,
      slug: 'acme',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isActive: true,
      passwordHash: await bcrypt.hash('correct', 10),
    });

    await expect(
      service.login({
        email: 'a@b.com',
        password: 'wrong',
        tenantSlug: 'acme',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logs in successfully with valid credentials', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      isActive: true,
      slug: 'acme',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      role: Role.SALES_REP,
      isActive: true,
      passwordHash: await bcrypt.hash('correct', 10),
    });
    prisma.user.update.mockResolvedValue({});

    const result = await service.login({
      email: 'a@b.com',
      password: 'correct',
      tenantSlug: 'acme',
    });

    expect(result.user.id).toBe('u1');
    expect(result.tenantSlug).toBe('acme');
    expect(result.tokens.accessToken).toBe('signed-token');
  });

  // ── Sessions, lockout and the allowlist ────────

  const signedInUser = () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      slug: 'acme',
      isActive: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'admin@acme.com',
      firstName: 'Ada',
      lastName: 'Admin',
      role: Role.TENANT_ADMIN,
      isActive: true,
      passwordHash: bcrypt.hashSync('Password123!', 4),
    });
    prisma.user.update.mockResolvedValue({});
  };

  it('opens a session for the device that signed in', async () => {
    signedInUser();

    await service.login(
      { email: 'admin@acme.com', password: 'Password123!', tenantSlug: 'acme' },
      { ipAddress: '1.2.3.4', userAgent: 'Chrome/120 Windows' },
    );

    expect(security.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        ipAddress: '1.2.3.4',
        userAgent: 'Chrome/120 Windows',
      }),
    );
  });

  it('records the sign-in, and records the failures too', async () => {
    signedInUser();
    await service.login(
      { email: 'admin@acme.com', password: 'Password123!', tenantSlug: 'acme' },
      {},
    );
    expect(security.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );

    security.recordAttempt.mockClear();
    await service
      .login(
        { email: 'admin@acme.com', password: 'wrong', tenantSlug: 'acme' },
        {},
      )
      .catch(() => undefined);
    expect(security.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, reason: 'bad_password' }),
    );
  });

  it('refuses to test a password at all once locked out', async () => {
    signedInUser();
    security.lockout.mockResolvedValue({
      locked: true,
      failures: 5,
      until: new Date(),
    });

    await expect(
      service.login(
        {
          email: 'admin@acme.com',
          password: 'Password123!',
          tenantSlug: 'acme',
        },
        {},
      ),
    ).rejects.toThrow('Too many failed attempts');
    // The correct password does not get through a lockout either.
    expect(security.createSession).not.toHaveBeenCalled();
  });

  it('blocks an address the tenant has not allowed, before the password', async () => {
    signedInUser();
    security.policy.mockResolvedValue({
      ...DEFAULT_POLICY,
      ipAllowlist: ['203.0.113.0/24'],
    });

    await expect(
      service.login(
        {
          email: 'admin@acme.com',
          password: 'Password123!',
          tenantSlug: 'acme',
        },
        { ipAddress: '8.8.8.8' },
      ),
    ).rejects.toThrow('not allowed from this network');
    expect(security.lockout).not.toHaveBeenCalled();
    expect(security.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ip_not_allowed' }),
    );
  });

  it('lets an allowed address through', async () => {
    signedInUser();
    security.policy.mockResolvedValue({
      ...DEFAULT_POLICY,
      ipAllowlist: ['203.0.113.0/24'],
    });

    await expect(
      service.login(
        {
          email: 'admin@acme.com',
          password: 'Password123!',
          tenantSlug: 'acme',
        },
        { ipAddress: '203.0.113.9' },
      ),
    ).resolves.toBeDefined();
  });

  it('rotates the refresh token rather than reusing it', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.in',
      firstName: 'A',
      lastName: 'B',
      role: Role.TENANT_ADMIN,
      isActive: true,
    });
    security.liveSession.mockResolvedValue({ id: 's1' });

    await service.refresh('old-token', { ipAddress: '1.2.3.4' });

    expect(security.rotateSession).toHaveBeenCalledWith(
      's1',
      'signed-token',
      '1.2.3.4',
    );
  });

  it('refuses a refresh token that belongs to no live session', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      isActive: true,
      refreshToken: null,
    });
    security.liveSession.mockResolvedValue(null);

    await expect(service.refresh('stale')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('signs out one device, not all of them', async () => {
    prisma.user.update.mockResolvedValue({});

    await service.logout('u1', 'this-device-token');

    expect(security.revokeByToken).toHaveBeenCalledWith(
      'this-device-token',
      'signed_out',
    );
  });

  it('gives every issued token its own id', async () => {
    signedInUser();
    // Two sign-ins in the same second used to produce byte-identical tokens,
    // and the second collided with the first on the session token hash.
    await service.login(
      { email: 'admin@acme.com', password: 'Password123!', tenantSlug: 'acme' },
      {},
    );
    await service.login(
      { email: 'admin@acme.com', password: 'Password123!', tenantSlug: 'acme' },
      {},
    );

    const first = jwt.signAsync.mock.calls[0][0].jti;
    const third = jwt.signAsync.mock.calls[2][0].jti;
    expect(first).toEqual(expect.any(String));
    expect(third).not.toBe(first);
  });
});
