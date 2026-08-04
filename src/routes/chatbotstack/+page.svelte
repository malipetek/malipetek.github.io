
<h1> Chatbot Stack </h1>

<div class="stack-container">
  <a href="https://www.flowise.com/" target="_blank" style="--brand-color: #222; --ring-color: #2563eb;">
    <div class="icon">
      <img src="flowise.webp" />
    </div>
    <h2>Flowise</h2>
  </a>
  <a href="https://nvidia.com/" target="_blank" style="--brand-color: #000; --ring-color: #f54f36;">
    <div class="icon">
      <img src="nvidia.png" />
    </div>
    <h2>NVIDIA</h2>
  </a>
  <a href="https://z.ai" target="_blank" style="--brand-color: #fff; --ring-color: #0082fb;">
    <div class="icon">
      <img src="zai.svg" />
    </div>
    <h2>Zai/GLM-5.2</h2>
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
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
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
    margin: 10px 0;
    border-radius: 8px;
    background-color: var(--brand-color);
    color: inherit;
    overflow: hidden;
    flex: 0 0 auto;
    width: 100%;
    aspect-ratio: 4;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>