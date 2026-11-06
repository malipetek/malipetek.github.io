/**
 * "Copy agent instructions" — the first action on every plugin.
 *
 * One delegated listener rather than a handler per button: the shelf renders
 * cards and detail pages independently, and cards are re-rendered by view
 * transitions, so per-element listeners would leak or miss.
 */
export function initCopyAgentInstructions(): void {
  if ((window as unknown as { __agentCopyBound?: boolean }).__agentCopyBound) return;
  (window as unknown as { __agentCopyBound?: boolean }).__agentCopyBound = true;

  document.addEventListener('click', async (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('[data-copy-agent]');
    if (button === null || button === undefined) return;

    const text = button.dataset.copyAgent ?? '';
    if (text.length === 0) return;
    const label = button.dataset.label ?? 'Copy agent instructions';

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      button.dataset.copied = 'true';
      setTimeout(() => {
        button.textContent = label;
        delete button.dataset.copied;
      }, 1600);
    } catch {
      // Clipboard access can be refused (insecure context, permission). Say so
      // rather than pretending it worked.
      button.textContent = 'Copy blocked — select the text on the page';
      setTimeout(() => {
        button.textContent = label;
      }, 2600);
    }
  });
}
