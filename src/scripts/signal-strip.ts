/* The signal strip: a thin canvas band under a lab index header. A dot-matrix
 * wave drifts on its own and leans toward the pointer; the crest burns orange.
 * Decorative only — aria-hidden, and it paints a single still frame when the
 * visitor prefers reduced motion. */
export function initSignalStrips(): void {
  document.querySelectorAll('[data-signal-strip]').forEach((strip) => {
    const canvas = strip as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let pointerX = 0.5;
    let targetX = 0.5;

    const draw = (time: number) => {
      const css = getComputedStyle(canvas);
      const rule = css.getPropertyValue('--rule-strong').trim() || '#d2ccc2';
      const orange = css.getPropertyValue('--orange').trim() || '#ff5a1f';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cell = 10;
      const cols = Math.max(8, Math.floor(width / cell));
      const rows = Math.max(4, Math.floor(height / cell));
      const cw = width / cols;
      const ch = height / rows;

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const envelope = Math.sin((Math.PI * (x + 0.5)) / cols);
          const wave = Math.sin(x * 0.42 + time * 0.0011 + pointerX * Math.PI * 2);
          const drift = Math.cos(x * 0.13 - time * 0.0006) * 0.18;
          const target = rows * 0.5 + (wave + drift) * rows * 0.24 * envelope;
          const dist = Math.abs(y + 0.5 - target);
          let fill = rule;
          let alpha = 0.07 + 0.05 * Math.sin(x * 0.8 + y * 0.5 + time * 0.001);
          let radius = Math.min(cw, ch) * 0.13;
          if (dist < 0.85) {
            fill = orange;
            alpha = 0.92;
            radius = Math.min(cw, ch) * 0.31;
          } else if (dist < 1.7) {
            alpha = 0.34;
            radius = Math.min(cw, ch) * 0.18;
          }
          ctx.globalAlpha = alpha;
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.arc((x + 0.5) * cw, (y + 0.5) * ch, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw(reduced ? 0 : performance.now());
    };

    const loop = (now: number) => {
      if (reduced) return;
      pointerX += (targetX - pointerX) * 0.06;
      draw(now);
      requestAnimationFrame(loop);
    };

    window.addEventListener('pointermove', (event) => {
      targetX = event.clientX / window.innerWidth;
    }, { passive: true });
    new ResizeObserver(resize).observe(canvas);
    if (reduced) {
      new MutationObserver(() => draw(0)).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
    resize();
    if (!reduced) requestAnimationFrame(loop);
  });
}
