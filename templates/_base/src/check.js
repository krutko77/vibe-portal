// Проверка подключения к VibeCode API
// Запуск: npm run check
// Ожидаемый результат: "API connection OK"

import 'dotenv/config';
import { vibe } from './utils/api.js';

try {
  const data = await vibe('/users', { params: { limit: 1 } });
  const count = data?.data?.length ?? data?.result?.length ?? 0;
  console.log('✓ API connection OK');
  console.log(`  Портал: ${process.env.VIBE_BASE_URL}`);
  console.log(`  Пользователей найдено (тест): ${count}`);
} catch (err) {
  console.error('✗ API connection FAILED:', err.message);
  console.error('  Проверь VIBE_API_KEY в файле .env');
  process.exit(1);
}
