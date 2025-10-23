// Liste des administrations avec césures officielles DSFR
const cesuresAdmin = {
  "République française": "République<br>Française",
  "Premier ministre": "Premier<br>ministre",
  "Ministère de l’Intérieur": "Ministère<br>de l’Intérieur",
  "Ministère des Armées": "Ministère<br>des Armées",
  "Ministère de la Justice": "Ministère<br>de la Justice",
  "Ministère de la Culture": "Ministère<br>de la Culture",
  "Ministère de l’Économie et des Finances": "Ministère<br>de l’Économie<br>et des Finances",
  "Ministère de la Transition écologique et solidaire": "Ministère<br>de la Transition<br>écologique et solidaire",
  "Ministère des Solidarités et de la Santé": "Ministère<br>des Solidarités<br>et de la Santé",
  "Ministère de l’Éducation nationale et de la Jeunesse": "Ministère<br>de l’Éducation<br>nationale et de la Jeunesse",
  "Ministère des Sports": "Ministère<br>des Sports",
  "Ministère des Outre-mer": "Ministère<br>des Outre-mer",
  "Ministère de la Cohésion des territoires": "Ministère<br>de la Cohésion<br>des territoires",
  "Ministère de l’Agriculture et de l’Alimentation": "Ministère<br>de l’Agriculture<br>et de l’Alimentation"
};

// Remplissage de la liste déroulante au chargement
document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('intitule');
  Object.keys(cesuresAdmin).forEach(key => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    select.appendChild(option);
  });
});

// Fonction pour échapper le HTML avant insertion
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

// Mise à jour de la prévisualisation
function applyPreview({ intitule, nomService, baseline, logoUrl }) {
  const intElem = document.getElementById('intitule-officiel');
  const nomElem = document.getElementById('nom-service');
  const baseElem = document.getElementById('baseline-text');
  const opSec = document.getElementById('operator-section');
  const logo = document.getElementById('logo-img');

  intElem.innerHTML = cesuresAdmin[intitule] || intitule || 'République<br>Française';
  nomElem.textContent = nomService || '';
  baseElem.textContent = baseline || '';

  if (logoUrl && logoUrl.trim() !== '') {
    logo.src = logoUrl;
    opSec.style.display = 'block';
  } else {
    logo.removeAttribute('src');
    opSec.style.display = 'none';
  }

  document.getElementById('preview').style.display = 'block';
}

// Génération du HTML final
function buildFinalHtml({ intitule, nomService, baseline, logoUrl }) {
  const marque = cesuresAdmin[intitule] || intitule || 'République<br>Française';
  const opBlock = logoUrl
    ? `<div class="fr-header__operator"><img class="fr-responsive-img" style="max-width:9rem;" src="${logoUrl}" alt="Logo"></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.13.1/dist/dsfr/dsfr.min.css">
<style>
body {margin:0;background:#fff;}
.fr-header, .fr-header__brand {filter:none!important;}
</style>
</head>
<body>
<header role="banner" class="fr-header">
  <div class="fr-header__body">
    <div class="fr-container">
      <div class="fr-header__body-row">
        <div class="fr-header__brand fr-enlarge-link">
          <div class="fr-header__brand-top">
            <div class="fr-header__logo">
              <p class="fr-logo">${marque}</p>
            </div>
            ${opBlock}
          </div>
          <div class="fr-header__service">
            <p class="fr-header__service-title">${escapeHtml(nomService)}</p>
            <p class="fr-header__service-tagline">${escapeHtml(baseline)}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</header>
</body>
</html>`;
}

// Récupération des données du formulaire
function getData() {
  return {
    intitule: document.getElementById('intitule').value,
    nomService: document.getElementById('nomService').value,
    baseline: document.getElementById('baseline').value,
    logoUrl: document.getElementById('logoUrl').value
  };
}

// Prévisualisation
document.getElementById('btn-preview').addEventListener('click', () => {
  const data = getData();
  applyPreview(data);
  document.getElementById('result-block').style.display = 'none';
});

// Génération du code
document.getElementById('btn-generate').addEventListener('click', () => {
  const data = getData();
  applyPreview(data);
  const html = buildFinalHtml(data);
  document.getElementById('export-code').value = html;
  document.getElementById('result-block').style.display = 'block';
});

// Copie du code
document.getElementById('btn-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.getElementById('export-code').value);
  alert('✅ Code copié dans le presse-papiers');
});

// Téléchargement du code
document.getElementById('btn-download').addEventListener('click', () => {
  const html = document.getElementById('export-code').value;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'header-dsfr.html';
  a.click(); URL.revokeObjectURL(url);
});

// Réinitialisation
document.getElementById('btn-reset').addEventListener('click', () => {
  document.getElementById('config-form').reset();
  document.getElementById('preview').style.display = 'none';
  document.getElementById('result-block').style.display = 'none';
});
