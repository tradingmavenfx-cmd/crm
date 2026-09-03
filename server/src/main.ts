import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: config.get<string>('corsOrigin'),
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Enterprise CRM Pro API')
    .setDescription(
      [
        'Two ways to authenticate:',
        '',
        '- **Bearer token** — a signed-in person, from `POST /api/auth/login`.',
        '- **API key** — a program, in `X-API-Key` or as `Authorization: Bearer crm_…`.',
        '  A key carries scopes (`contacts:read`, `deals:write`, `*`); the scope needed',
        '  for a request is its first path segment plus `read` for GET and `write` for',
        '  anything else. Keys cannot be used on `/auth` or `/security`.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port') ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 CRM server running on http://localhost:${port}/api`);
}

void bootstrap();
