<script>
  export const frontmatter = {
    title: `Experience`,
    tagline: `Programming web servers and front end since 2017`,
  };
  import RandomBadge from "$lib/components/RandomBadge.svelte";

  let options = [
        {
            year: '2017-2019',
            name: "Customily 🇺🇾",
            items: [
            {
                title: "Stack",
                tags: [
                "SDK",
                "Fabric.js",
                "Canvas API",
                "jQuery",
                "Webpack",
                "Shopify App",
                "Firebase",
                "Shopify Admin",
                "Theme injection",
                "Express",
                "Vuetify",
                "MSSQL",
                "Win Server",
                "Image Processing",
                "PHP",
                "Woocommerce",
                "Cloud Functions",
                "Vue2",
              ],
              description:
                "Customily is a SaaS, and I worked on service integration and JS SDK development for 2 years.",
            },
            {
              title: "Bigcommerce",
              tags: [
                "Firebase",
                "Firestore",
                "Cloud Functions",
                "Vue2",
                "Vuetify",
              ],
              description: ``,
            },
            {
              title: "Woocommerce",
              tags: ["WP Plugin", "PHP", "Vue2"],
              description: "...",
            },
          ],
        },
        {
        year: 2020,
          name: "TRUTH NYC 🇺🇸",
          description: `<p> TURTH NYC is a world class design tech agency. Their projects are like so diverse I wouldnt believe they had these connections before I worked with them. Best place for a world class design. </p> Learn more about <a href="/experience/truth" class="text-blue-500">TRUTH NYC</a>`,
          items: [
            {
              title: "Magento Front End",
              tags: ["Requirejs", "Knockoutjs", "WP sub site"],
              description: "...",
            },
            {
              title: "Lightspeed HQ/ECom integration",
              tags: [
                "Firebase Cloud Functions",
                "Expressjs",
                "Rest APIs",
                "Sync",
              ],
              description: "...",
            },
            {
              title: "Lightspeed eCom Checkout Mod.",
              tags: ["Address filtering", "Tipping"],
              description: "...",
            },
            {
              title: "Lightspeed eCom Theme rewrite",
              tags: [
                "jQuery",
                "Twig/rain",
                "Tailwind",
                "Subscription/Stripe integration",
              ],
              description: "...",
            },
          ],
        },
        {
        year: '2021-2024',
          name: "TRUTH NYC 🇺🇸",
          description: `Learn more about <a href="/experience/truth" class="text-blue-500">TRUTH NYC</a>`,
          items: [
            {
              title: "Shopify Plus Client Migration",
              tags: ["Data normalization (nodejs)"],
              description: "...",
            },
            {
              title: "Theme build",
              tags: [
                "Based on Dawn",
                "Custom collection filtering",
                "B2B pricing included",
              ],
              description: "...",
            },
            {
              title: "Custom App",
              tags: [
                "B2B pricing @ checkout",
                "Flow integration",
                "Custom emails (Heroku - Koajs - Nextjs - Postgres)",
              ],
              description: "...",
            },
          ],
        },
        {
        year: 2022,
          name: "PAX Digital 🇹🇷",
          description: `Learn more about <a href="https://paxdigital.net/" class="text-blue-500">PAX Digital</a>`,
          items: [
            {
              title: "Public Shopify App",
              tags: ["Expressjs", "Nextjs", "Websockets", "Linux Server"],
              description: "...",
            },
          ],
        },
        {
          name: "Bemeir LLC 🇺🇸",
          year: '2022-2023',
          description: `<p> Bemeir is a high tier e-commerce agency in the US. Their clients were piling up when we worked together, they are growing so fast they do something right definitely. </p> Learn more about <a href="https://bemeir.com/" class="text-blue-500">Bemeir LLC</a>`,
          items: [
            {
              title: "Plus Client",
              tags: [
                "Custom Sections",
                "Maintenance",
                "checkout.liquid customization/optimization",
                "SEO improvement implementations",
                "AB Testing",
              ],
              description: "...",
            },
            {
              title: "Advanced to Plus Client",
              tags: [
                "Theme Optimization",
                "Instagram app setup",
                "Product Page",
                "Size chart",
                "Homepage Sections",
                '"srcset" optimization',
              ],
              description: "...",
            },
          ],
        },
  ];
</script>

<div class="container">
  <h1>Experience</h1>

  <ol
    class="relative border-s border-gray-200 dark:border-gray-700 list-none"
    style="border-inline-start-style: solid;"
  >
    {#each options as option}
      <li class="mb-10 ms-4">
        <div
          class="absolute w-3 h-3 bg-gray-200 rounded-full mt-1.5 -start-1.5 border border-white dark:border-gray-900 dark:bg-gray-700"
        ></div>
        <time
          class="mb-1 text-sm font-normal leading-none text-gray-400 dark:text-gray-500"
          >{option.year}</time
        >
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
          {option.name}
        </h3>
        <p
          class="mb-4 text-base font-normal text-gray-500 dark:text-gray-400"
        >{@html option.description || ''}</p>

        {#if Array.isArray(option.items)}
          {#each option.items as op}
            <li class="mb-10 ms-4">
              <div
                class="absolute w-3 h-3 bg-gray-200 rounded-full mt-1.5 -start-1.5 border border-white dark:border-gray-900 dark:bg-gray-700"
              ></div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                {op.title}
              </h3>
              <p
                class="mb-4 text-base font-normal text-gray-500 dark:text-gray-400"
              >
                {op.description}
              </p>
              {#if Array.isArray(op.tags)}
                <ul class="list-none">
                  {#each op.tags as tag (Math.random())}
                    <li class="inline-block me-2">
                      <RandomBadge text={tag} />
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        {/if}
      </li>
    {/each}
  </ol>

</div>

<style>
</style>
