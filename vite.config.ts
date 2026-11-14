import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/simpliigence-dashboard/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Heavy libraries get their own long-cached chunks; pages are split by the lazy routes.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', 'zustand'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
          office: ['xlsx', 'docx'],
        },
      },
    },
  },
})
