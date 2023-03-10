import path from 'path';

export default {
  title: 'malipetek',
  description: 'Your Favorite Full Stack Developer',
  lang: 'en-US',
  srcDir: './',
  outDir: 'build',
  base: '/',
  plugins: ['@vuepress/active-header-links', 'vuepress-plugin-table-of-contents'],
  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/malipetek' },
      { icon: 'twitter', link: 'https://twitter.com/malipetek' },
      { icon: 'youtube', link: 'https://www.youtube.com/@malipetek/featured' },
      { icon: 'linkedin', link: 'https://www.linkedin.com/in/malipetek/' },
    ],
    // logo: '/liquivelte.png',
    nav: [
      { text: '🤝 Get a Quote', link: '/quote-request' },
      { text: '📞 Book a call', link: '/book-call' },
    ],
    sidebar: [
      {
        text: 'About',
        items: [
          {
            text: 'Experience',
            collapsed: false,
            items: [
              { text: 'Customily', link: '/customily' },
              { text: 'TRUTH', link: '/truth' },
            ]
          },
          {
            text: 'Ecom Platforms',
            collapsed: false,
            items: [
              { text: 'Shopify', link: '/shopify' },
              { text: 'Lightspeed eCom', link: '/lightspeed' },
            ]
          }
        ]
      },
      {
        text: 'Business',
        collapsed: false,
        items: [
          { text: 'Shopify Theme Development', link: 'business/shopify-theme-development' },
          { text: 'Shopify Theme Maintenance', link: 'business/shopify-theme-maintenance' },
          { text: 'Shopify App Development', link: '/business/shopify-app-development' },
          { text: 'Front End Development', link: '/business/front-end-development' },
          { text: 'Full Stack Development', link: '/business/full-stack-development' },
          { text: 'Other Offer', link: '/business/offer' },
        ]
      },
      {
        text: 'Blog',
        collapsed: true,
        items: [
          {
            text: 'Web',
            collapsed: false,
            items: [
              {
                text: 'CSS only toggleables', link: 'blog/web/CSS only toggleables.md' },
            ]
          },
          {
            text: 'Shopify',
            collapsed: false,
            items: [
              { text: 'How to use Partytown on Shopify without Builder.io', link: '/blog/shopify/how-to-partytown' }
            ]
          },
          {
            text: 'LightSpeed',
            collapsed: true,
            items: [
            ]
          },
          {
            text: 'Linux',
            collapsed: true,
            items: [
              { text: 'Ubuntu Accessing Google Drive from Nautilus', link: 'blog/linux/Ubuntu Accessing Google Drive from Nautilus.md' },
              { text: 'Linux Mint XFCE How I made VGA display configuration persist', link: 'blog/linux/Linux Mint XFCE How I made VGA display configuration persist.md' },
              { text: 'How I Solved Chrome GPU Issue On My Linux Mint', link: 'blog/linux/How I Solved Chrome GPU Issue On My Linux Mint.md' },
              { text: 'Convert Bash Scripts Into Named CLI Commands in Linux', link: 'blog/linux/Convert Bash Scripts Into Named CLI Commands in Linux.md' }
            ]
          },
        ]
      },
    ]
  },
  markdown: {
    theme: 'github-dark',
    languages: [{
      id: 'liquivelte',
      scopeName: 'source.liquivelte',
      path: path.resolve(__dirname, './liquivelte.tmLanguage.json')
    },
    {
      id: 'svelte',
      scopeName: 'source.svelte',
      path: path.resolve(__dirname, './svelte.tmLanguage.json')
    },
      'javascript',
      'css',
      'liquid',
      'scss',
      'sass',
      'less'
    ]
  },
  footer: {
    message: 'Released under the <a href="https://github.com/vuejs/vitepress/blob/main/LICENSE">MIT License</a>.',
    copyright: 'Copyright © 2019-present <a href="https://github.com/yyx990803">Evan You</a>'
  }
};