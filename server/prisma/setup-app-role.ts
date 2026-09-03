/**
 * Creates the database role the application runs as.
 *
 * Row-level security is not a suggestion the database makes: a superuser
 * ignores it outright, and so does the table owner unless FORCE is set. The
 * policies are FORCEd, but the application still has to connect as a role that
 * is neither a superuser nor BYPASSRLS — otherwise every policy in the schema
 * is decoration.
 *
 * Run once, as an administrator:
 *   npm run db:setup-role
 *
 * It reads DIRECT_DATABASE_URL (the owner connection, used for migrations) and
 * APP_DB_PASSWORD, and is safe to run again.
 */
import { PrismaClient } from '@prisma/client';

const ROLE = process.env.APP_DB_USER ?? 'crm_app';
const PASSWORD = process.env.APP_DB_PASSWORD;

async function main() {
  if (!PASSWORD) {
    throw new Error(
      'Set APP_DB_PASSWORD to the password the application will use',
    );
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(ROLE)) {
    throw new Error('APP_DB_USER must be a plain lowercase identifier');
  }

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const database = new URL(url!).pathname.replace('/', '');
  // Quoted so a password containing a quote cannot end the literal early.
  const password = PASSWORD.replace(/'/g, "''");

  const statements = [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
         CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}';
       ELSE
         ALTER ROLE ${ROLE} LOGIN PASSWORD '${password}';
       END IF;
     END $$;`,
    // Explicitly, in case the role was created by hand with either of these.
    `ALTER ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS;`,
    `GRANT CONNECT ON DATABASE "${database}" TO ${ROLE};`,
    `GRANT USAGE ON SCHEMA public TO ${ROLE};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};`,
    // So a table added by a later migration is reachable without rerunning this.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE};`,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const [check] = await prisma.$queryRawUnsafe<
    { rolsuper: boolean; rolbypassrls: boolean }[]
  >(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${ROLE}'`);

  // eslint-disable-next-line no-console
  console.log(
    `Role "${ROLE}" ready — superuser: ${check.rolsuper}, bypasses RLS: ${check.rolbypassrls}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `Point DATABASE_URL at it, and keep DIRECT_DATABASE_URL on the owner for migrations.`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
