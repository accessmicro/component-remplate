import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['prettier/standalone', 'prettier/plugins/babel', 'prettier/plugins/estree'],
  },
})
