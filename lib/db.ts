import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('⚠️  DATABASE_URL environment variable is not set!');
  console.error('📝 To fix this in Vercel:');
  console.error('   1. Go to your Vercel project dashboard');
  console.error('   2. Settings → Environment Variables');
  console.error('   3. Add DATABASE_URL with your Neon PostgreSQL connection string');
  console.error('   4. Redeploy your application');
  throw new Error('DATABASE_URL environment variable is not set');
}

// Neon serverless SQL client
// Hanya gunakan ini dalam API routes (server-side), BUKAN dalam React components
export const sql = neon(process.env.DATABASE_URL);
