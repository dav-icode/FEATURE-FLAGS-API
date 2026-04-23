import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

/**
 * Seed script: creates an initial admin API key and sample flags.
 * Run with: npx ts-node prisma/seed.ts
 */
async function main() {
  console.log('🌱 Seeding database...');

  // ── Create admin API key ──────────────────────────────────────────
  const rawKey = `ff_${uuidv4().replace(/-/g, '')}`;
  const prefix = rawKey.substring(0, 8);
  const hash = await bcrypt.hash(rawKey, 12);

  await prisma.apiKey.upsert({
    where: { keyHash: hash },
    update: {},
    create: {
      name: 'Admin Key (seed)',
      keyHash: hash,
      keyPrefix: prefix,
      permissions: ['flags:read', 'flags:write', 'evaluate', 'audit:read'],
      enabled: true,
      createdBy: 'seed',
    },
  });

  console.log('\n✅ Admin API Key created:');
  console.log(`   Key: ${rawKey}`);
  console.log('   ⚠️  Save this key — it will NOT be shown again.\n');

  // ── Create sample flags ───────────────────────────────────────────

  const sampleFlags = [
    {
      key: 'new-sap-integration',
      name: 'New SAP Integration Module',
      description: 'Enables the refactored SAP Event Mesh integration flow',
      enabled: true,
      createdBy: 'seed',
      rules: {
        create: [
          {
            type: 'ENVIRONMENT' as const,
            value: { environments: ['development', 'staging'] },
            priority: 10,
          },
        ],
      },
    },
    {
      key: 'beta-dashboard',
      name: 'Beta Analytics Dashboard',
      description: 'New dashboard with real-time charts, available to beta users',
      enabled: true,
      createdBy: 'seed',
      rules: {
        create: [
          {
            type: 'PERCENTAGE' as const,
            value: { percentage: 20 },
            priority: 5,
          },
        ],
      },
    },
    {
      key: 'dark-mode',
      name: 'Dark Mode UI',
      description: 'Global dark mode toggle for all users',
      enabled: false,
      createdBy: 'seed',
    },
  ];

  for (const flag of sampleFlags) {
    await prisma.flag.upsert({
      where: { key: flag.key },
      update: {},
      create: flag,
    });
    console.log(`✅ Flag created: ${flag.key}`);
  }

  console.log('\n🚀 Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
