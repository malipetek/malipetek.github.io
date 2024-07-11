import { defineConfig } from 'vite'
import { sveltepress } from '@sveltepress/vite'
import { defaultTheme } from '@sveltepress/theme-default'
import { url } from 'inspector';
import mermaid from 'vite-plugin-markdown-mermaid';

const config = defineConfig({
  plugins: [
    // mermaid({}),
    sveltepress({
      theme: defaultTheme({
        github: 'https://github.com/malipetek',
        navbar: [
        ],
        
        sidebar: {
          home: [{
            items: [{
              title: 'Chat',
              to: '/chat',
            },
            {
              title: 'Experience',
              to: '/experience',
            }],
          }]
        },
        logo: '/me.webp',
        preBuildIconifyIcons: {
          'skill-icons': ['svelte'],
        }
      }),
      siteConfig: {
        title: 'Muhammet Ali Petek',
        description: 'Your favorite full stack JS developer',
      },
    }),
  ],
})

export default config
