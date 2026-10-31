import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node', env: { RATE_LIMIT_SHARED: 'off' }, include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'src/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
