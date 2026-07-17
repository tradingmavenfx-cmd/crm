import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };

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

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
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
        tenant: { create: jest.fn().mockResolvedValue({ id: 't1', slug: 'acme' }) },
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
    expect(result.tokens.accessToken).toBe('signed-token');
    expect(result.tokens.refreshToken).toBe('signed-token');
  });

  it('rejects login with an unknown tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'x@y.com',
        password: 'pw',
        tenantSlug: 'nope',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login with a wrong password', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true, slug: 'acme' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isActive: true,
      passwordHash: await bcrypt.hash('correct', 10),
    });

    await expect(
      service.login({ email: 'a@b.com', password: 'wrong', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logs in successfully with valid credentials', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true, slug: 'acme' });
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
    expect(result.tokens.accessToken).toBe('signed-token');
  });
});
