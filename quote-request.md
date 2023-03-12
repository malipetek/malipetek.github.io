---
prev: false
next: false
---
<script setup>
import { ref } from "vue";
import { useData } from "vitepress";
const { isDark } = useData();

const email = ref("");
const items = ref([{
    label: "Shopify",
    value: 'shopify',
    image: 'images/shopify-icon.svg'
  }, {
    label: "Development",
    value: 'development',
    image: 'images/javascript.svg'
  }, {
    label: "Smt Else",
    value: 'generic',
    image: 'images/chat.svg'
  }]);
const selection = ref('shopify');

  </script>
<style lang="postcss">
  @import "vuetify/dist/vuetify.min.css";
  .vp-doc._quote-request .contact-form, .vp-doc._quote-request #send-a-request, .vp-doc._quote-request p {
    margin-left: auto;
    margin-right: auto;
    text-align:  center;
  }
  @media screen and (min-width: 960px) {
    .vp-doc._quote-request .contact-form, .vp-doc._quote-request #send-a-request, .vp-doc._quote-request p {
      margin-left: initial;
      margin-right: initial;
      text-align: left;
    }
  }


</style>

# Send a request
<br />

<v-sheet theme="{{ isDark ? 'dark' : 'light' }}" width="320" 
        class="contact-form" >
  <v-form ref="form" id="contact-form" action="https://formsubmit.co/malipetek@gmail.com" method="POST">
    <input type="hidden" name="_subject" :value="selection">
    <input type="hidden" name="_next" value="https://malipetek.github.io/form-sent">
    <div class="d-flex flex-column">
      <v-text-field
          variant="outlined"
          hide-details="auto"
          label="Email address"
          placeholder="your@email.com"
          type="email"
          name="email"
          clearable
          required
        >
      </v-text-field>
    </div>
    <div class="mt-8">
      <div class="text-large mb-2"> Query type </div>
      <div 
        class="grid grid-flow-row-dense grid-cols-3 grid-rows-auto gap-4"
        >
        <div 
        v-for="(entry, index) in items" 
        >
          <input :checked="index == 0" name="query_type" :id="'qt-'+index" :value="entry.value" type="radio" group="qtype" class="hidden peer" v-model="selection" /> 
          <label :for="'qt-'+index"
              class="h-40 cursor-pointer rounded border-2 border-gray-700 flex items-center justify-center peer-checked:border-green-700 flex-col"> 
          <img :src="entry.image" width="50" />
          <p class="!mb-0 text-sm"> {{ entry.label }} </p>
        </label>
        </div>
      </div>
    </div>
    <div class="mt-4">
      <v-textarea clearable label="Message (optional)" variant="outlined" name="message"></v-textarea>
    </div>
    <div class="d-flex flex-column mt-4">
      <v-btn 
            type="submit" 
            variant="outlined"
            color="green" 
            form="contact-form"
            class="" block>
          Submit
      </v-btn>
    </div>
  </v-form>
</v-sheet>

Not feel like typing? [Book a quick call](book-call)
