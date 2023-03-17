import DefaultTheme from 'vitepress/theme';
import vuetify from './plugins/vuetify';
import googleAnalytics from 'vitepress-plugin-google-analytics';
import './vuetify.postcss';
import './tailwind.postcss';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp(ctx) {
    // register your custom global components
    ctx.app.use(vuetify);
    googleAnalytics({
      id: 'G-W88DDBE0KY',
    })
  }
};