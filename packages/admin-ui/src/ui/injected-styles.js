import { useLayoutEffect } from 'react';

/**
 * One `<style>` element per stylesheet, in the document head, reused by every
 * mount. The legacy pages each rendered their own copy of the whole stylesheet;
 * this keeps the CSS out of the component tree and out of duplicate rules.
 */
export function InjectedStyles({ id, css }) {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let element = document.getElementById(id);
    if (element === null) {
      element = document.createElement('style');
      element.id = id;
      element.dataset.adminUi = 'styles';
      document.head.appendChild(element);
    }
    if (element.textContent !== css) element.textContent = css;
    return undefined;
  }, [css, id]);
  return null;
}
