// Four existing, real workshop photographs. Load gallery collections only on
// pages where visitors request the full gallery.
const heroPhotos = [
  ['hero-results', 'PAINT CORRECTION'], ['refresh-result', 'REFRESH DETAILING'],
  ['paint-result', 'PAINT CORRECTION'], ['ceramic-result', 'CERAMIC COATING']
];
const heroImage = document.getElementById('heroResultImg');
const heroDots = document.getElementById('heroResultDots');
let heroCurrent = 0;
function showHero(index) {
  heroCurrent = index;
  const [file, label] = heroPhotos[index];
  heroImage.srcset = `images/real/${file}-640.webp 640w, images/real/${file}-1200.webp 1200w`;
  heroImage.src = `images/real/${file}-1200.webp`;
  heroImage.alt = `Actual SUN PRO ${label.toLowerCase()} result in Wangara`;
  document.getElementById('heroResultLabel').textContent = label;
  heroDots.querySelectorAll('button').forEach((dot, i) => { dot.classList.toggle('is-active', i === index); dot.setAttribute('aria-pressed', String(i === index)); });
}
heroPhotos.forEach(([file, label], index) => {
  const dot = document.createElement('button');
  dot.type = 'button'; dot.className = 'hero-result-dot';
  dot.setAttribute('aria-label', `View ${label.toLowerCase()} result ${index + 1}`);
  dot.addEventListener('click', () => showHero(index)); heroDots.appendChild(dot);
});
showHero(heroCurrent);
