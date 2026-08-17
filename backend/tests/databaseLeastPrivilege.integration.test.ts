import { PrismaClient } from '@prisma/client';

const appDatabaseUrl = process.env.TEST_APP_DATABASE_URL;
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const describeWithDatabaseRoles = appDatabaseUrl && migrationDatabaseUrl ? describe : describe.skip;

describeWithDatabaseRoles('production PostgreSQL least-privilege contract', () => {
  let app: PrismaClient;
  let migration: PrismaClient;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(() => {
    app = new PrismaClient({ datasources: { db: { url: appDatabaseUrl! } } });
    migration = new PrismaClient({ datasources: { db: { url: migrationDatabaseUrl! } } });
  });

  afterAll(async () => {
    await Promise.all([app.$disconnect(), migration.$disconnect()]);
  });

  test('runtime role is non-superuser and has no role/database creation attributes', async () => {
    const rows = await app.$queryRaw<
      Array<{
        rolname: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
        canCreateDatabaseObject: boolean;
        canCreateTemporaryTable: boolean;
        canCreateSchemaObject: boolean;
      }>
    >`
      SELECT
        rolname,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolreplication,
        rolbypassrls,
        has_database_privilege(current_user, current_database(), 'CREATE') AS "canCreateDatabaseObject",
        has_database_privilege(current_user, current_database(), 'TEMPORARY') AS "canCreateTemporaryTable",
        has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreateSchemaObject"
      FROM pg_roles
      WHERE rolname = current_user
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      canCreateDatabaseObject: false,
      canCreateTemporaryTable: false,
      canCreateSchemaObject: false,
    });
  });

  test('runtime role can perform required application DML', async () => {
    const id = `least_privilege_${suffix}`;
    const phoneNumber = `+1999${Date.now().toString().slice(-8)}`;

    try {
      await app.$executeRaw`
        INSERT INTO "OtpCode" ("id", "phoneNumber", "codeHash", "expiresAt")
        VALUES (${id}, ${phoneNumber}, ${'least-privilege-test-hash'}, ${new Date(Date.now() + 60_000)})
      `;
      await app.$executeRaw`
        UPDATE "OtpCode" SET "attempts" = 1 WHERE "id" = ${id}
      `;
      const rows = await app.$queryRaw<Array<{ attempts: number }>>`
        SELECT "attempts" FROM "OtpCode" WHERE "id" = ${id}
      `;
      expect(rows).toEqual([{ attempts: 1 }]);
    } finally {
      await app.$executeRaw`DELETE FROM "OtpCode" WHERE "id" = ${id}`;
    }
  });

  test('runtime role cannot read or mutate the Prisma migration ledger', async () => {
    await expect(
      app.$queryRawUnsafe('SELECT migration_name FROM public."_prisma_migrations" LIMIT 1'),
    ).rejects.toThrow(/permission denied/u);
  });

  test('runtime role cannot create tables, roles or extensions', async () => {
    const tableName = `least_privilege_table_${suffix}`;
    const temporaryTableName = `least_privilege_temp_${suffix}`;
    const roleName = `least_privilege_role_${suffix}`;
    const extensionRows = await migration.$queryRaw<Array<{ name: string }>>`
      SELECT name
      FROM pg_available_extensions
      WHERE installed_version IS NULL
      ORDER BY CASE WHEN name = 'hstore' THEN 0 ELSE 1 END, name
      LIMIT 1
    `;

    expect(extensionRows).toHaveLength(1);
    const extensionName = extensionRows[0]?.name;
    if (!extensionName) {
      throw new Error('PostgreSQL test image exposes no uninstalled extension for the DDL probe');
    }
    const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
    const denied = /permission denied|must be superuser|not permitted|must have CREATEROLE/iu;

    try {
      await expect(
        app.$executeRawUnsafe(`CREATE TABLE public.${quoteIdentifier(tableName)} (id integer)`),
      ).rejects.toThrow(denied);
      await expect(
        app.$executeRawUnsafe(
          `CREATE TEMPORARY TABLE ${quoteIdentifier(temporaryTableName)} (id integer)`,
        ),
      ).rejects.toThrow(denied);
      await expect(
        app.$executeRawUnsafe(`CREATE ROLE ${quoteIdentifier(roleName)}`),
      ).rejects.toThrow(denied);
      await expect(
        app.$executeRawUnsafe(`CREATE EXTENSION ${quoteIdentifier(extensionName)}`),
      ).rejects.toThrow(denied);
    } finally {
      // Fail-safe cleanup if a future privilege regression makes an assertion
      // above unexpectedly succeed before Jest reports the failure.
      await migration.$executeRawUnsafe(
        `DROP TABLE IF EXISTS public.${quoteIdentifier(tableName)}`,
      );
      await app.$executeRawUnsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(temporaryTableName)}`);
      await migration.$executeRawUnsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`);
      await migration.$executeRawUnsafe(
        `DROP EXTENSION IF EXISTS ${quoteIdentifier(extensionName)}`,
      );
    }
  });
});
