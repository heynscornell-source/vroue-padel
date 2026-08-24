/* ============================================================
   Vul hierdie lêer in nadat jy die Firebase-projek geskep het.
   Niks hierin is geheim nie — die beskerming sit in die
   Firestore-reëls en die groep se wagwoord, nie hier nie.
   ============================================================ */

export const firebaseConfig = {
  apiKey: "AIzaSyDFs6yQeORZW96IhA9eCo-XxY3WLVygbiw",
  authDomain: "vroue-padel-liga.firebaseapp.com",
  databaseURL: "https://vroue-padel-liga-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "vroue-padel-liga",
  storageBucket: "vroue-padel-liga.firebasestorage.app",
  messagingSenderId: "841261232200",
  appId: "1:841261232200:web:20a93d36a9d82d4c95e87d",
  measurementId: "G-QSNR9670EZ"
};

/* Die enkele gedeelde rekening wat jy in Firebase Authentication skep.
   Die wagwoord staan NIE hier nie — dit word elke keer ingetik. */
export const SHARED_EMAIL = "span@vrouepadel.co.za";

/* Die dokument in Firestore waarin die seisoen leef. */
export const SEASON_ID = "seisoen1";
