// plugins/vuetify.js
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import 'vuetify/styles';

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'dark'
  }
});