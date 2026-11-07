/* The signal strip: a thin canvas band under a lab index header. A dot-matrix
 * wave drifts on its own and leans toward the pointer; the crest burns orange.
 * Decorative only — aria-hidden, and it paints a single still frame when the
 * visitor prefers reduced motion. */
let disposeSignalStrips: (() => void) | undefined;

export function initSignalStrips(): () => void {
  // Re-initialization must not leave an old loop or observer attached.
  disposeSignalStrips?.();
  const disposers: (() => void)[] = [];
  document.querySelectorAll('[data-signal-strip]').forEach((strip) => {
    const canvas = strip as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const events = new AbortController();
    let visible = false;
    let suspended = false;
    let frame: number | undefined;
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
      draw(motion.matches ? 0 : performance.now());
    };

    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
    const canAnimate = () => !motion.matches && visible && !document.hidden && !suspended;
    const loop = (now: number) => {
      frame = undefined;
      if (!canAnimate()) return;
      pointerX += (targetX - pointerX) * 0.06;
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      stop();
      if (motion.matches) {
        // A deterministic still frame, independent of the last pointer position.
        pointerX = targetX = 0.5;
        draw(0);
      } else if (canAnimate()) {
        frame = requestAnimationFrame(loop);
      }
    };

    window.addEventListener('pointermove', (event) => {
      if (canAnimate()) targetX = event.clientX / window.innerWidth;
    }, { passive: true, signal: events.signal });
    motion.addEventListener('change', sync, { signal: events.signal });
    document.addEventListener('visibilitychange', sync, { signal: events.signal });
    window.addEventListener('pagehide', () => {
      suspended = true;
      stop();
    }, { signal: events.signal });
    window.addEventListener('pageshow', () => {
      suspended = false;
      sync();
    }, { signal: events.signal });
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    visibilityObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      if (motion.matches || !canAnimate()) draw(motion.matches ? 0 : performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    disposers.push(() => {
      stop();
      events.abort();
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
    });
    resize();
  });
  const dispose = () => {
    disposers.forEach((cleanup) => cleanup());
    document.removeEventListener('astro:before-swap', dispose);
    if (disposeSignalStrips === dispose) disposeSignalStrips = undefined;
  };
  document.addEventListener('astro:before-swap', dispose, { once: true });
  disposeSignalStrips = dispose;
  return dispose;
}
