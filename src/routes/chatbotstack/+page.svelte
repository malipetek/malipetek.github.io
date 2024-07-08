
<h1> Chatbot Stack </h1>

<div class="stack-container">
  <a href="https://www.flowise.com/" target="_blank" style="--brand-color: #222; --ring-color: #2563eb;">
    <div class="icon">
      <img src="flowise.webp" />
    </div>
    <h2>Flowise</h2>
  </a>
  <a href="https://groq.com/" target="_blank" style="--brand-color: #fff; --ring-color: #f54f36;">
    <div class="icon">
      <img src="groq.svg" />
    </div>
    <h2>Groq</h2>
  </a>
  <a href="https://llama.meta.com/llama3/" target="_blank" style="--brand-color: #fff; --ring-color: #0082fb;">
    <div class="icon">
      <img src="meta.svg" />
    </div>
    <h2>Llama3-70b</h2>
  </a>
  <a href="https://directus.io/" target="_blank" style="--brand-color: #64f; --ring-color: #64f;">
    <div class="icon">
      <img src="directus.svg" />
    </div>
    <h2>Directus</h2>
  </a>
</div>
<style>
  .stack-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin-top: 20px;
  }
  img {
    width: 100px;
  }
  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    border-radius: 8px;
    outline: 0px solid var(--ring-color);
    box-shadow: var(--docsearch-key-shadow);
  }

  a:hover {
    outline-width: 2px;
    transition: outline-width 0.3s;
  }
  .icon {
    margin: 10px;
    border-radius: 8px; 
    background-color: var(--brand-color); 
    padding: 1em 0.5em 0.5em 0.5em; 
    color: inherit;
    overflow: hidden;
    flex: 0 0 auto;
    aspect-ratio: 3;
  }
</style>