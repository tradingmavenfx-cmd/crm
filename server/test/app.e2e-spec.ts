import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full application (DI graph, global guards, validation pipe)
 * with an in-memory Prisma stub so it runs without a live database.
 */
describe('App (e2e)', () => {
  let app: INestApplication;

  const prismaStub = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health -> 200 (public route)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('crm-server');
  });

  it('GET /api/contacts -> 401 without a token (guard active)', async () => {
    await request(app.getHttpServer()).get('/api/contacts').expect(401);
  });

  it('POST /api/auth/register -> 400 on invalid body (validation pipe)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
