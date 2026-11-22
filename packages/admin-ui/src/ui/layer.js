/*
 * The overlay stack shared by Menu and Modal: Escape closes only the top
 * layer, and the shell's shortcuts stand down while any layer is open.
 */
import { useEffect, useState } from 'react';

/** The layers open right now, top last. */
const layers = [];
export const isTop = (token) => layers[layers.length - 1] === token;
export function useLayer() {
  const [token] = useState(() => ({}));
  useEffect(() => {
    layers.push(token);
    return () => {
      const i = layers.indexOf(token);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [token]);
  return token;
}
/** True while any menu, dialog or palette is open (the shell's shortcuts stand down). */
export const layerOpen = () => layers.length > 0;

let uidSeq = 0;
/** A stable id for aria wiring, unique per mounted component. */
export const useUid = (prefix) => {
  const [id] = useState(() => `${prefix}-${++uidSeq}`);
  return id;
};
