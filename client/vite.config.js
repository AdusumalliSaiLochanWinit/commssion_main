import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    // Bumped from default 500 KB so the warning only fires on truly heavy chunks.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy third-party libs into separate long-cacheable chunks. A
        // page-level change doesn't bust the vendor cache, and page chunks stay
        // small enough to load on demand via React.lazy().
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('react-dom') || id.includes('scheduler')) return 'vendor-react-dom';
          if (id.includes('/react/')) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('date-fns')) return 'vendor-date';
          if (id.includes('axios') || id.includes('zustand') || id.includes('react-hot-toast') ||
              id.includes('clsx') || id.includes('tailwind-merge')) return 'vendor-utils';
          return 'vendor';
        },
      },
    },
  },
});
