import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The single .env / .env.example at the repo root serves both halves.
  envDir: '..',
})
