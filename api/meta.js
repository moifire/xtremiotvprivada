function makeMeta(item, db) {
  const defaultPoster = db?.settings?.defaultPoster || 'https://placehold.co/600x900/png?text=No+Logo';
  const defaultBackground = db?.settings?.defaultBackground || 'https://placehold.co/1280x720/png?text=MoiTube';

  const poster =
    item.poster ||
    item.logo ||
    item.background ||
    item.tvgLogo ||
    defaultPoster;

  const background =
    item.background ||
    item.posterLandscape ||
    item.backdrop ||
    item.poster ||
    item.logo ||
    item.tvgLogo ||
    defaultBackground;

  const meta = {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description || '',
    poster,
    background,
    genres: item.genres || [],
    year: item.year || undefined
  };

  if (item.type === 'series' && Array.isArray(item.videos)) {
    meta.videos = item.videos.map(v => ({
      id: v.id,
      title: v.title || ('T' + v.season + ' E' + v.episode),
      season: v.season,
      episode: v.episode,
      released: v.released
    }));
  }

  return meta;
}
