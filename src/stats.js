// stats 模块 facade — re-export + 导航绑定，子模块独立存放在 discover/report/likes/albums.js
import { $ } from './utils.js';
import { openDiscover } from './discover.js';

export { openDiscover };

export function initStats() {
  $('navDiscover').onclick = openDiscover;
  import('./report.js').then(({ openStats }) => { $('navStats').onclick = openStats; });
  import('./likes.js').then(({ openLikesPage }) => { $('navLikes').onclick = openLikesPage; });
  import('./albums.js').then(({ openSavedAlbums }) => {
    const el = $('navSavedAlbums');
    if (el) el.addEventListener('click', openSavedAlbums);
  });
}
