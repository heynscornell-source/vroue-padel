# Vroue Padel Americano

Dashboard vir 'n agt-vrou padelgroep oor agt weke.

Die webwerf self bevat geen persoonlike inligting nie. Die name, bankbesonderhede,
speeltye, punte en betalings leef in Firestore en is slegs sigbaar vir wie met die
groep se wagwoord aangemeld het.

## Lêers

| Lêer | Wat dit doen |
|---|---|
| `index.html` | Die bladsy se dop |
| `styles.css` | Alle uitleg en kleur |
| `app.js` | Die logika: rotasie, punte, koste |
| `config.js` | **Die enigste lêer wat jy invul** — jou Firebase-projek se besonderhede |
| `firestore.rules` | Die reëls om in die Firebase-konsole te plak |
| `robots.txt` | Hou soekenjins weg |
| `.nojekyll` | Nodig vir GitHub Pages |

## Opstel

Sien die stap-vir-stap gids wat saam met hierdie lêers gestuur is.

Kortliks:
1. Firebase-projek skep → Firestore-databasis skep → reëls uit `firestore.rules` plak.
2. Authentication aanskakel (E-pos/wagwoord) → een gebruiker skep → daardie e-posadres
   in `config.js` by `SHARED_EMAIL` sit, en die wagwoord met die groep deel.
3. Webtoepassing registreer → die `firebaseConfig`-blok in `config.js` plak.
4. Alles na 'n GitHub-repo oplaai → Settings → Pages aanskakel.
5. Die adres oopmaak, wagwoord intik, en die eenmalige opstelskerm invul.
