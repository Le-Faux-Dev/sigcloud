// Rendu d'un aperçu (partagé entre l'espace connecté et la page de partage public).
import { h, icon, spinner, clear } from './dom.js';
import { mountMap } from './map-viewer.js';
import { previewReasonText, projectWarning } from './ui.js';
import { formatBytes } from './format.js';

/**
 * @param {HTMLElement} container
 * @param {{file: any, config: any, fetchPreview: () => Promise<any>, onDownload?: () => void, canDownload: boolean}} opts
 * @returns {Promise<{destroy: () => void}>}
 */
export async function renderPreview(container, { file, config, fetchPreview, onDownload, canDownload }) {
  clear(container);
  let destroy = () => {};

  const unsupported = () => {
    container.append(
      h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'empty' },
          icon('database', 'icon-xl'),
          h('h2', { text: 'Stocké, non prévisualisable' }),
          h('p', { text: previewReasonText(file, config) }),
          onDownload && canDownload ? h('button', { type: 'button', class: 'btn btn-primary', on: { click: onDownload } }, icon('download'), h('span', { text: `Télécharger l'original (${formatBytes(file.sizeBytes)})` })) : null,
        ),
      ),
    );
    if (file.category === 'project') container.append(projectWarning());
  };

  if (file.previewStatus !== 'PREVIEWABLE') {
    unsupported();
    return { destroy };
  }

  container.append(spinner("Préparation de l'aperçu…"));
  let data;
  try {
    data = await fetchPreview();
  } catch (err) {
    clear(container);
    if (err.code === 'NOT_PREVIEWABLE') {
      unsupported();
    } else {
      container.append(h('div', { class: 'empty', role: 'alert' }, icon('triangle-alert', 'icon-xl'), h('h2', { text: "Aperçu indisponible" }), h('p', { text: err.message })));
    }
    return { destroy };
  }
  clear(container);

  if (data.kind === 'geojson') {
    try {
      const m = await mountMap(container, data.data, data.meta ?? file.geoMeta);
      destroy = m.destroy;
    } catch (err) {
      container.append(h('div', { class: 'form-error', role: 'alert' }, icon('triangle-alert'), h('span', { text: err.message })));
    }
  } else if (data.kind === 'image') {
    // L'URL est signée et de courte durée ; l'image est décrite par le nom du fichier.
    container.append(h('div', { class: 'viewer-media' }, h('img', { src: data.url, alt: `Aperçu de ${file.name}`, referrerpolicy: 'no-referrer' })));
  } else if (data.kind === 'pdf') {
    // Pas d'attribut sandbox : le lecteur PDF de Chrome refuse de s'afficher dans un cadre « sandboxé ». Le PDF est servi
    // depuis l'origine du stockage (distincte de l'application), donc sans accès à la session ni au DOM de l'application.
    container.append(
      h('iframe', { class: 'viewer-frame', src: data.url, title: `Aperçu PDF de ${file.name}`, referrerpolicy: 'no-referrer' }),
      h('p', { class: 'help' }, 'Le PDF ne s\'affiche pas ? ', h('a', { href: data.url, target: '_blank', rel: 'noopener noreferrer', text: 'Ouvre-le dans un nouvel onglet' }), '.'),
    );
  } else if (data.kind === 'text') {
    container.append(h('pre', { class: 'text-preview', tabindex: '0', 'aria-label': `Contenu de ${file.name}`, text: data.text }));
    if (data.truncated) container.append(h('p', { class: 'help', text: "Seul le début du fichier est affiché. Télécharge l'original pour le lire en entier." }));
  }
  return { destroy: () => destroy() };
}
