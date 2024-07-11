import { defineConfig } from 'vite'
import { sveltepress } from '@sveltepress/vite'
import { defaultTheme } from '@sveltepress/theme-default'
import path from 'path';

const config = defineConfig({
  plugins: [
    sveltepress({
      theme: defaultTheme({
        github: 'https://github.com/malipetek',
        navbar: [
        ],
        highlighter: {
          languages: [
            {
              id: 'liquivelte',
              scopeName: 'source.liquivelte',
              name: 'liquivelte',
              path: path.resolve(__dirname, './liquivelte.tmLanguage.json'),
              languages: ['html', 'liquid', 'svelte'],
            },
            'svelte',
            'shellscript',
            'javascript',
            'css',
            'liquid',
            'scss',
            'sass',
            'less'
          ]
        },
        sidebar: {
          home: [{
            items: [{
              title: 'Chat',
              to: '/chat',
            },
            {
              title: 'Experience',
              to: '/experience',
            },
            {
              title: 'TRUTH NYC',
              to: '/experience/truth',
            },]
          },
          {
            title: 'Blog',
            collapsible: true,
            open: false,
            items: [{
              title: 'Shopify',
              to: '/blog/shopify',
              collapsible: true,
              items: [{
                title: 'How to Partytown 🎉',
                to: '/blog/shopify/how-to-partytown',
              }]
            }, {
              title: 'Linux',
              to: '/blog/linux',
              collapsible: true,
              items: [
                { title: "Convert Bash Scripts Into Named CLI Commands in Linux", to: '/blog/linux/Convert Bash Scripts Into Named CLI Commands in Linux' },
                { title: "How I Solved Chrome GPU Issue On My Linux Mint", to: '/blog/linux/How I Solved Chrome GPU Issue On My Linux Mint' },
                { title: "Ubuntu Accessing Google Drive from Nautilus", to: '/blog/linux/Ubuntu Accessing Google Drive from Nautilus' },
                { title: "Linux Mint XFCE How I made VGA display configuration persist", to: '/blog/linux/Linux Mint XFCE How I made VGA display configuration persist' },
              ]
              }, {
              title: 'Svelte',
              to: '/blog/svelte',
              collapsible: true,
              items: [
                {
                  title: "Why my image is not hydrating right",
                  to: '/blog/svelte/why-my-image-is-not-hydrating-right'
                },
              ]
              },
              {
                title: 'Web',
                to: '/blog/web',
                collapsible: true,
                items: [
                  {
                    title: 'CSS only toggleables',
                    to: '/blog/web/CSS only toggleables',
                  }
                ]
            }],
          }
          ]
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
