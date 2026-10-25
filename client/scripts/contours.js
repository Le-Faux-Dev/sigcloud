// Insère les courbes de niveau décoratives (SVG propre au projet) sans innerHTML : analyse XML puis importNode.
export async function mountContours(host) {
  try {
    const res = await fetch('/assets/contours.svg');
    if (!res.ok) return;
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('script,foreignObject')) return;
    host.replaceChildren(document.importNode(svg, true));
    host.querySelectorAll('.lvl').forEach((p, i) => { p.style.animationDelay = `${i * 70}ms`; });
  } catch {
    /* décoratif : on ignore */
  }
}
