<script>
    export const frontmatter = {
      title: `Experience`,
      tagline: `Programming web servers and front end since 2017`
    }
	import {
		Timeline,
		TimelineItem,
		TimelineSeparator,
		TimelineDot,
		TimelineConnector,
		TimelineContent,
		TimelineOppositeContent
	} from 'svelte-vertical-timeline';

  let options = [
    { 
      title: 'Customily 🇺🇾', time: '2017',
    },
    { title: 'SDK', time: 'Fabric.js' },
    { title: 'Canvas API', time: 'jQuery' },
    { title: 'Webpack', time: 'Shopify App' },
    { title: 'Fabric.js', time: 'Canvas API' },
    { title: 'jQuery', time: 'Webpack' },
    { title: 'Shopify App', time: 'Fabric.js' },
    { title: 'Firebase', time: 'Shopify Admin' },
    { title: 'Shopify Admin', time: 'Theme injection' },
    { title: 'Express', time: 'Vuetify' },
    { title: 'Vuetify', time: 'Shopify App Migration' },
    { title: 'MSSQL', time: 'Win Server' },
    { title: 'Image Processing', time: 'PHP' },
    { title: 'Woocommerce', time: 'WP Plugin' },
    { title: 'WP Plugin', time: 'Cloud Functions' },
    { title: 'Cloud Functions', time: 'Vue2, Vuetify' },
    { title: 'Vue2, Vuetify', time: 'Firebase' },
    { title: 'Firebase', time: 'Firestore' },
    { title: 'Firestore', time: 'Bigcommerce' },
    { title: 'Bigcommerce', time: '2019' },
    { title: '2019', time: '2020' },
    { title: '2020', time: '2021' },
    { title: '2021', time: '2022' },
    
  ]
</script>

<style>
  
</style>

<div class="container">


<Timeline position="alternate" style={"border: solid 1px #dbdbdb; padding: 50px 0; border-radius: 2%;"}>
	{#each options as option}
		<TimelineItem>
			<TimelineOppositeContent slot="opposite-content">
				<p>{option.time}</p>
			</TimelineOppositeContent>
			<TimelineSeparator>
				<TimelineDot style={'background-color: #7CD5E2;'}/>
				<TimelineConnector />
			</TimelineSeparator>
			<TimelineContent>
				<h3>{option.title}</h3>
			</TimelineContent>
		</TimelineItem>
	{/each}
</Timeline>
<svg id="mermaid-svg" xmlns="http://www.w3.org/2000/svg" style="max-width: 7790px;" viewBox="0 -64 7790 857" role="graphics-document document" aria-roledescription="timeline" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
      <marker id="arrowhead" refX="5" refY="2" markerWidth="6" markerHeight="4" orient="auto">
          <path d="M 0,0 V 4 L6,2 Z"/>
      </marker>
  </defs>
  <g transform="translate(100, 50)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h1380 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="1390" y2="67.8"/>
          </g>
          <g transform="translate(695, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Customily   🇺🇾</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(100, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2018</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="195" y1="235.60000000000002" x2="195" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(100, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(300, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">SDK</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="395" y1="235.60000000000002" x2="395" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(300, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🏞️   Fabric.js</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(300, 427.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🌄   Canvas   API</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(300, 487.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">jQuery</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(300, 547.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">⚙️   Webpack</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(500, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Shopify   App</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="595" y1="235.60000000000002" x2="595" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(500, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🏞️   Fabric.js</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(500, 427.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🔥   Firebase</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(500, 487.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🛍️   Shopify   Admin</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(500, 547.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line--1" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🧑‍💻   Theme</tspan>
                  <tspan x="0" dy="1.1em">injection</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(500, 623.199998474121)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Express</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(500, 683.199998474121)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Vuetify</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(700, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Shopify   App</tspan>
                  <tspan x="0" dy="1.1em">Migration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="795" y1="235.60000000000002" x2="795" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(700, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">💾   MSSQL</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(700, 427.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🖥️   Win   Server</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(700, 487.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🏞️   Image   Processing</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(900, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2019</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="995" y1="235.60000000000002" x2="995" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(900, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(1100, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Bigcommerce</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="1195" y1="235.60000000000002" x2="1195" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(1100, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🔥   Firebase</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1100, 427.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">💾   Firestore</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1100, 487.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">⚙️   Cloud   Functions</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1100, 547.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Vue2,   Vuetify</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(1300, 167.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line--1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Woocommerce</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="1395" y1="235.60000000000002" x2="1395" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(1300, 367.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🌐   WP   Plugin</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1300, 427.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🖥️   PHP</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1300, 487.8)">
      <g class="timeline-node section--1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line--1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Vue2</tspan>
              </text>
          </g>
      </g>
  </g>
  <g transform="translate(1500, 50)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h2380 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-0" x1="0" y1="67.8" x2="2390" y2="67.8"/>
          </g>
          <g transform="translate(1195, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">TRUTH   NYC   🇺🇸</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(1500, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-0" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2020</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="1595" y1="235.60000000000002" x2="1595" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(1500, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(1700, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-0" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Magento   Front   End</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="1795" y1="235.60000000000002" x2="1795" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(1700, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🎯   Requirejs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1700, 427.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Knockoutjs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1700, 487.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">WP   sub   site</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(1900, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Lightspeed</tspan>
                  <tspan x="0" dy="1.1em">HQ/ECom</tspan>
                  <tspan x="0" dy="1.1em">integration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="1995" y1="250.7999969482422" x2="1995" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(1900, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-0" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Firebase   Cloud</tspan>
                  <tspan x="0" dy="1.1em">Functions</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1900, 443.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Expressjs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1900, 503.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Rest   APIs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(1900, 563.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Sync</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(2100, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Lightspeed   eCom</tspan>
                  <tspan x="0" dy="1.1em">Checkout   Mod.</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="2195" y1="250.7999969482422" x2="2195" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(2100, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Address   filtering</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(2100, 427.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Tipping</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(2300, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Lightspeed   eCom</tspan>
                  <tspan x="0" dy="1.1em">Theme   rewrite</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="2395" y1="250.7999969482422" x2="2395" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(2300, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">jQuery</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(2300, 427.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Twig/rain</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(2300, 487.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Tailwind</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(2300, 547.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-0" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Subscription/Stripe</tspan>
                  <tspan x="0" dy="1.1em">integration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(2500, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2021</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="2595" y1="250.7999969482422" x2="2595" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(2500, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(2700, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Shopify   Plus   Client</tspan>
                  <tspan x="0" dy="1.1em">👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="2795" y1="250.7999969482422" x2="2795" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="taskWrapper" transform="translate(2900, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Migration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="2995" y1="250.7999969482422" x2="2995" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(2900, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-0" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Data   narmalization</tspan>
                  <tspan x="0" dy="1.1em">nodejs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(3100, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Theme   build</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="3195" y1="250.7999969482422" x2="3195" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(3100, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Based   on   Dawn</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3100, 427.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-0" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Csutom   collection</tspan>
                  <tspan x="0" dy="1.1em">filtering</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3100, 503.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">B2B   pricing   included</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(3300, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Custom   App</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="3395" y1="250.7999969482422" x2="3395" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(3300, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-0" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">B2B   pricing   @</tspan>
                  <tspan x="0" dy="1.1em">checkout</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3300, 443.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Flow   integration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3300, 503.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Custom   emails</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3300, 563.1999984741211)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-0" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Heroku   -   Koajs   -</tspan>
                  <tspan x="0" dy="1.1em">Nextjs   -   Postgres</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(3500, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2022</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="3595" y1="250.7999969482422" x2="3595" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(3500, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(3700, 167.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-0" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">CD   Setup</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="3795" y1="250.7999969482422" x2="3795" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(3700, 367.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Github   Actions</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3700, 427.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Airtable</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3700, 487.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">React   static</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(3700, 547.8)">
      <g class="timeline-node section-0">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-0" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Github   Pages</tspan>
              </text>
          </g>
      </g>
  </g>
  <g transform="translate(3900, 50)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h580 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-1" x1="0" y1="67.8" x2="590" y2="67.8"/>
          </g>
          <g transform="translate(295, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">PAX   Digital   🇹🇷</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(3900, 167.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2022</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="3995" y1="235.60000000000002" x2="3995" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(3900, 367.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(4100, 167.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Public   Shopify   App</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="4195" y1="235.60000000000002" x2="4195" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(4100, 367.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Expressjs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4100, 427.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Nextjs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4100, 487.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🔗   Websockets</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4100, 547.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🖥️   Linux   Server</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(4300, 167.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-1" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Shopify   Theme</tspan>
                  <tspan x="0" dy="1.1em">Migration   To   2.0</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="4395" y1="235.60000000000002" x2="4395" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(4300, 367.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Third   party   theme</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4300, 427.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-1" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Collection   page</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4300, 487.8)">
      <g class="timeline-node section-1">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-1" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Custom   account</tspan>
                  <tspan x="0" dy="1.1em">page</tspan>
              </text>
          </g>
      </g>
  </g>
  <g transform="translate(4500, 50)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h780 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-2" x1="0" y1="67.8" x2="790" y2="67.8"/>
          </g>
          <g transform="translate(395, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Bemeir   LLC   🇺🇸</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(4500, 167.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-2" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2022</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="4595" y1="235.60000000000002" x2="4595" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(4500, 367.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(4700, 167.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-2" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Plus   Client</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="4795" y1="235.60000000000002" x2="4795" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(4700, 367.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Custom   Sections</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4700, 427.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Maintenance</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4700, 487.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-2" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">checkout.liquid</tspan>
                  <tspan x="0" dy="1.1em">customization/optimization</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4700, 563.1999984741211)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-2" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">SEO   improvement</tspan>
                  <tspan x="0" dy="1.1em">implementations</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(4700, 638.5999969482422)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">AB   Testing</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(4900, 167.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-2" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Advanced   to   Plus</tspan>
                  <tspan x="0" dy="1.1em">Client</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="4995" y1="235.60000000000002" x2="4995" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(4900, 367.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Theme   Optimization</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(5100, 167.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-2" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Plus   Theme   Rewrite</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="5195" y1="235.60000000000002" x2="5195" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(5100, 367.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Instagram   app   setup</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5100, 427.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Product   Page</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5100, 487.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Size   chart</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5100, 547.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Homepage   Sections</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5100, 607.8)">
      <g class="timeline-node section-2">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-2" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">"srcset"   optimization</tspan>
              </text>
          </g>
      </g>
  </g>
  <g transform="translate(5300, 50)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h2380 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-3" x1="0" y1="67.8" x2="2390" y2="67.8"/>
          </g>
          <g transform="translate(1195, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">TRUTH   NYC   🇺🇸</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(5300, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-3" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2020</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="5395" y1="235.60000000000002" x2="5395" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(5300, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(5500, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 62.8 v-57.8 q0,-5 5,-5 h180 q5,0 5,5 v62.8 H0 Z"/>
              <line class="node-line-3" x1="0" y1="67.8" x2="190" y2="67.8"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Magento   Front   End</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="5595" y1="235.60000000000002" x2="5595" y2="727.7999984741211" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(5500, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🎯   Requirejs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5500, 427.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Knockoutjs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5500, 487.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">WP   sub   site</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(5700, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Lightspeed</tspan>
                  <tspan x="0" dy="1.1em">HQ/ECom</tspan>
                  <tspan x="0" dy="1.1em">integration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="5795" y1="250.7999969482422" x2="5795" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(5700, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-3" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Firebase   Cloud</tspan>
                  <tspan x="0" dy="1.1em">Functions</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5700, 443.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Expressjs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5700, 503.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Rest   APIs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5700, 563.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Sync</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(5900, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Lightspeed   eCom</tspan>
                  <tspan x="0" dy="1.1em">Checkout   Mod.</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="5995" y1="250.7999969482422" x2="5995" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(5900, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Address   filtering</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(5900, 427.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Tipping</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(6100, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Lightspeed   eCom</tspan>
                  <tspan x="0" dy="1.1em">Theme   rewrite</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="6195" y1="250.7999969482422" x2="6195" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(6100, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">jQuery</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(6100, 427.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Twig/rain</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(6100, 487.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Tailwind</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(6100, 547.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-3" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Subscription/Stripe</tspan>
                  <tspan x="0" dy="1.1em">integration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(6300, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2021</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="6395" y1="250.7999969482422" x2="6395" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(6300, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(6500, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Shopify   Plus   Client</tspan>
                  <tspan x="0" dy="1.1em">👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="6595" y1="250.7999969482422" x2="6595" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="taskWrapper" transform="translate(6700, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Migration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="6795" y1="250.7999969482422" x2="6795" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(6700, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-3" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Data   narmalization</tspan>
                  <tspan x="0" dy="1.1em">nodejs</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(6900, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Theme   build</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="6995" y1="250.7999969482422" x2="6995" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(6900, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Based   on   Dawn</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(6900, 427.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-3" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Csutom   collection</tspan>
                  <tspan x="0" dy="1.1em">filtering</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(6900, 503.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">B2B   pricing   included</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(7100, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Custom   App</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="7195" y1="250.7999969482422" x2="7195" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(7100, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-3" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">B2B   pricing   @</tspan>
                  <tspan x="0" dy="1.1em">checkout</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(7100, 443.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Flow   integration</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(7100, 503.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Custom   emails</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(7100, 563.1999984741211)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 60.39999847412109 v-55.39999847412109 q0,-5 5,-5 h180 q5,0 5,5 v60.39999847412109 H0 Z"/>
              <line class="node-line-3" x1="0" y1="65.39999847412109" x2="190" y2="65.39999847412109"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Heroku   -   Koajs   -</tspan>
                  <tspan x="0" dy="1.1em">Nextjs   -   Postgres</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(7300, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">🗓️   2022</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="7395" y1="250.7999969482422" x2="7395" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(7300, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">👉👉👉</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="taskWrapper" transform="translate(7500, 167.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 77.99999694824218 v-72.99999694824218 q0,-5 5,-5 h180 q5,0 5,5 v77.99999694824218 H0 Z"/>
              <line class="node-line-3" x1="0" y1="82.99999694824218" x2="190" y2="82.99999694824218"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">CD   Setup</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="lineWrapper">
      <line x1="7595" y1="250.7999969482422" x2="7595" y2="742.9999954223633" stroke-width="2" stroke="black" marker-end="url(#arrowhead)" stroke-dasharray="5,5"/>
  </g>
  <g class="eventWrapper" transform="translate(7500, 367.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Github   Actions</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(7500, 427.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Airtable</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(7500, 487.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">React   static</tspan>
              </text>
          </g>
      </g>
  </g>
  <g class="eventWrapper" transform="translate(7500, 547.8)">
      <g class="timeline-node section-3">
          <g>
              <path id="node-undefined" class="node-bkg node-undefined" d="M0 45 v-40 q0,-5 5,-5 h180 q5,0 5,5 v45 H0 Z"/>
              <line class="node-line-3" x1="0" y1="50" x2="190" y2="50"/>
          </g>
          <g transform="translate(95, 10)">
              <text dy="1em" alignment-baseline="middle" dominant-baseline="middle" text-anchor="middle">
                  <tspan x="0" dy="1em">Github   Pages</tspan>
              </text>
          </g>
      </g>
  </g>
  <text x="3745" font-size="4ex" font-weight="bold" y="20">Tech Exposure Over Time</text>
  <g class="lineWrapper">
      <line x1="50" y1="285.6" x2="7740" y2="285.6" stroke-width="4" stroke="black" marker-end="url(#arrowhead)"/>
  </g>
</svg>
</div>